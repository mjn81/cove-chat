package com.cove.chat.security

import android.os.SystemClock
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.cove.chat.CoveApp
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** Outcome of an unlock attempt. */
sealed interface UnlockResult {
    data object Success : UnlockResult
    data object Incorrect : UnlockResult
    /** Too many wrong attempts; retry after [seconds]. */
    data class Throttled(val seconds: Int) : UnlockResult
}

/**
 * Optional local passcode for the app, like Telegram's. While locked, a full-screen overlay covers the app; the
 * passcode is stored only as a salted PBKDF2 hash. The app locks on a cold start and after it has been in the
 * background longer than the chosen timeout. With a passcode set the window is also marked secure, which blocks
 * screenshots and hides the content in the recent-apps view.
 *
 * This is a gate on the UI. The session token stays in the Keystore-backed encrypted preferences, and decrypted
 * attachment caches are wiped on sign-out (see `LocalData`).
 */
object AppLock {
    /** True while the lock screen must be shown. Observed by Compose. */
    var locked by mutableStateOf(false)
        private set

    private const val ITERATIONS = 210_000
    private const val FREE_ATTEMPTS = 5
    private const val MIN_LENGTH = 4

    private var backgroundedAt = 0L
    private var failures = 0
    private var blockedUntil = 0L

    private val prefs get() = CoveApp.instance.preferencesManager

    /** Whether a passcode is set. */
    val enabled: Boolean get() = !prefs.lockHash.isNullOrBlank()

    /** Locks right away on a cold start when a passcode exists. */
    fun init() {
        locked = enabled
    }

    /** Called when the app leaves the foreground. */
    fun onBackground() {
        backgroundedAt = SystemClock.elapsedRealtime()
    }

    /** Called when the app returns; locks if it was away longer than the timeout (-1 = only on restart). */
    fun onForeground() {
        if (!enabled || locked) return
        val timeout = prefs.lockTimeoutSeconds
        if (timeout >= 0 && SystemClock.elapsedRealtime() - backgroundedAt >= timeout * 1000L) locked = true
    }

    /** Locks now ("Lock now" in settings). */
    fun lock() {
        if (enabled) locked = true
    }

    /** Forgets the passcode and the lock state, e.g. when signing out of the account it protected. */
    fun reset() {
        prefs.lockHash = null
        prefs.lockSalt = null
        locked = false
        failures = 0
        blockedUntil = 0
    }

    /** Whether [code] is long enough to be accepted as a new passcode. */
    fun isValidNew(code: String): Boolean = code.codePointCount(0, code.length) >= MIN_LENGTH

    /** Sets or replaces the passcode. */
    fun setPasscode(code: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        prefs.lockSalt = Base64.encodeToString(salt, Base64.NO_WRAP)
        prefs.lockHash = Base64.encodeToString(hash(code, salt), Base64.NO_WRAP)
        failures = 0
        blockedUntil = 0
    }

    /** Whether [code] matches the saved passcode (no throttling; used to confirm a change or removal). */
    fun verify(code: String): Boolean {
        val salt = prefs.lockSalt?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return false
        val expected = prefs.lockHash?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return false
        return MessageDigest.isEqual(expected, hash(code, salt))
    }

    /** Checks the passcode, throttling repeated failures so guessing cannot be sped up. */
    fun unlock(code: String): UnlockResult {
        val now = SystemClock.elapsedRealtime()
        if (now < blockedUntil) return UnlockResult.Throttled(((blockedUntil - now) / 1000 + 1).toInt())
        if (verify(code)) {
            failures = 0
            locked = false
            return UnlockResult.Success
        }
        failures++
        if (failures >= FREE_ATTEMPTS) {
            val delaySeconds = (30L shl (failures - FREE_ATTEMPTS).coerceAtMost(5)).coerceAtMost(900L)
            blockedUntil = now + delaySeconds * 1000
        }
        return UnlockResult.Incorrect
    }

    /** Removes the passcode after the caller verified the current one. */
    fun remove() {
        prefs.lockHash = null
        prefs.lockSalt = null
        locked = false
    }

    private fun hash(code: String, salt: ByteArray): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(PBEKeySpec(code.toCharArray(), salt, ITERATIONS, 256))
            .encoded
}
