package com.cove.chat.data.update

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import com.cove.chat.BuildConfig
import com.cove.chat.data.local.PreferencesManager
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.contentLength
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext

/** What the update UI shows. Nothing here ever blocks the app: it is an entry in Settings and a dismissible card. */
sealed interface UpdateUi {
    data object Idle : UpdateUi
    data class Available(val offer: UpdateOffer) : UpdateUi
    data class Downloading(val offer: UpdateOffer, val percent: Int) : UpdateUi
    data class Ready(val offer: UpdateOffer, val file: File) : UpdateUi
    data class Failed(val offer: UpdateOffer?, val message: String) : UpdateUi
}

/** Result of handing the APK to the system installer. */
enum class InstallResult { Started, NeedsPermission, NotReady, Failed }

/**
 * Self-update for sideloaded / GitHub builds, following the Telegram approach: check quietly, tell the user with a
 * small entry, download only on a tap (or automatically on Wi-Fi if the user opted in), verify the SHA-256, then
 * hand the APK to the system installer. Android always asks the user to confirm the install; there is no silent
 * install. Store builds set `BuildConfig.SELF_UPDATE` to false and none of this runs.
 *
 * The HTTP client is separate from [com.cove.chat.data.remote.ApiClient] on purpose: the session token must never
 * be sent to covechat.dev or GitHub.
 */
class UpdateManager(private val app: Application, private val prefs: PreferencesManager) {
    private val client = HttpClient(OkHttp) {
        install(HttpTimeout) {
            connectTimeoutMillis = 10_000
            requestTimeoutMillis = 15 * 60_000L
        }
    }
    private val busy = Mutex()
    private val _state = MutableStateFlow<UpdateUi>(UpdateUi.Idle)

    /** Current state for the UI. */
    val state: StateFlow<UpdateUi> = _state.asStateFlow()

    /** False in store builds, where the store updates the app. */
    val enabled: Boolean get() = BuildConfig.SELF_UPDATE

    private val currentVersion: String get() = BuildConfig.VERSION_NAME

    private fun apkDir(): File = File(app.cacheDir, "updates").apply { mkdirs() }

    /**
     * Looks for a newer APK, at most once a day unless [force]. Cheap: one small JSON request. When the user opted in
     * to automatic downloads and the phone is on unmetered Wi-Fi, the download starts too; installing never does.
     */
    suspend fun check(force: Boolean = false) {
        if (!enabled) return
        val now = System.currentTimeMillis()
        if (!force && !UpdateLogic.checkDue(prefs.updateLastCheckMs, now)) return
        if (!busy.tryLock()) return
        try {
            if (_state.value is UpdateUi.Downloading || _state.value is UpdateUi.Ready) return
            val offer = withContext(Dispatchers.IO) { findOffer() }
            prefs.updateLastCheckMs = now
            _state.value = if (offer == null) UpdateUi.Idle else UpdateUi.Available(offer)
        } catch (e: Exception) {
            // A failed background check is silent; only a manual check (force) reports it.
            if (force) _state.value = UpdateUi.Failed(null, e.message ?: "Could not check for updates")
            return
        } finally {
            busy.unlock()
        }
        val offer = (_state.value as? UpdateUi.Available)?.offer ?: return
        if (UpdateLogic.mayAutoDownload(prefs.updateAutoDownload, onUnmeteredWifi()) && offer.directInstall) download()
    }

    /** Manifest first, GitHub second; null when nothing newer exists. */
    private suspend fun findOffer(): UpdateOffer? {
        val includePre = UpdateLogic.allowPrerelease(currentVersion, prefs.updateIncludePrerelease)
        val manifest = runCatching { fetchText(prefs.updateManifestUrl.ifBlank { DEFAULT_MANIFEST_URL }) }.getOrNull()
            ?.let { UpdateLogic.parseManifest(it) }
        if (manifest != null) return UpdateLogic.offerFrom(manifest, currentVersion, includePre)

        val pick = UpdateLogic.pickGitHubRelease(fetchText(GITHUB_RELEASES_URL), currentVersion, includePre) ?: return null
        return UpdateLogic.offerFromGitHub(pick, fetchText(pick.sumsUrl))
    }

    private suspend fun fetchText(url: String): String {
        require(url.startsWith("https://")) { "Update sources must use HTTPS" }
        val resp = client.get(url) { header("User-Agent", "cove-android/$currentVersion") }
        if (!resp.status.isSuccess()) error("Update source answered ${resp.status.value}")
        return resp.bodyAsText()
    }

    /** Downloads the offered APK into the app cache and verifies its SHA-256. Wrong checksum deletes the file. */
    suspend fun download() {
        val offer = (_state.value as? UpdateUi.Available)?.offer ?: (_state.value as? UpdateUi.Failed)?.offer ?: return
        if (!offer.directInstall || !busy.tryLock()) return
        try {
            _state.value = UpdateUi.Downloading(offer, 0)
            val file = withContext(Dispatchers.IO) { fetchApk(offer) }
            _state.value = UpdateUi.Ready(offer, file)
        } catch (e: Exception) {
            _state.value = UpdateUi.Failed(offer, e.message ?: "Download failed")
        } finally {
            busy.unlock()
        }
    }

    private suspend fun fetchApk(offer: UpdateOffer): File {
        require(offer.apkUrl.startsWith("https://")) { "Updates must be downloaded over HTTPS" }
        val dir = apkDir()
        dir.listFiles()?.forEach { it.delete() }
        val part = File(dir, "cove-${offer.version}.apk.part")
        val target = File(dir, "cove-${offer.version}.apk")
        client.prepareGet(offer.apkUrl) { header("User-Agent", "cove-android/$currentVersion") }.execute { resp ->
            if (!resp.status.isSuccess()) error("Download failed (${resp.status.value})")
            val total = resp.contentLength() ?: offer.size
            val channel = resp.bodyAsChannel()
            val buf = ByteArray(64 * 1024)
            var done = 0L
            var lastPercent = -1
            part.outputStream().use { out ->
                while (true) {
                    val n = channel.readAvailable(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    if (total > 0) {
                        val pct = (done * 100 / total).toInt().coerceIn(0, 100)
                        if (pct != lastPercent) {
                            lastPercent = pct
                            _state.value = UpdateUi.Downloading(offer, pct)
                        }
                    }
                }
            }
        }
        if (!UpdateLogic.verify(part, offer.sha256)) {
            part.delete()
            error("The downloaded update failed its integrity check and was discarded.")
        }
        part.renameTo(target)
        return target
    }

    /**
     * Hands the verified APK to the system installer. On Android 8+ the user must first allow installs from Cove
     * (Settings > Install unknown apps); this opens that screen once and returns [InstallResult.NeedsPermission].
     */
    fun install(context: Context): InstallResult {
        val ready = _state.value as? UpdateUi.Ready ?: return InstallResult.NotReady
        if (!UpdateLogic.verify(ready.file, ready.offer.sha256)) {
            ready.file.delete()
            _state.value = UpdateUi.Failed(ready.offer, "The downloaded update changed on disk and was discarded.")
            return InstallResult.Failed
        }
        if (!context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return InstallResult.NeedsPermission
        }
        return runCatching {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", ready.file)
            context.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            InstallResult.Started
        }.getOrDefault(InstallResult.Failed)
    }

    /** Hides the one-time chat-list card for this version (the Settings entry stays). */
    fun dismissCard(version: String) {
        prefs.updateDismissedVersion = version
    }

    /** True when the chat-list card has not been dismissed for [version]. */
    fun cardVisible(version: String): Boolean = prefs.updateDismissedVersion != version

    private fun onUnmeteredWifi(): Boolean {
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        val wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        return wifi && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }
}
