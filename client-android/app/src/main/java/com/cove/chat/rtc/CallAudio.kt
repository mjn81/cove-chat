package com.cove.chat.rtc

import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Where call audio plays. Labels go through the `Text` i18n helper. */
enum class AudioRoute(val label: String) {
    Earpiece("Earpiece"), Speaker("Speaker"), Bluetooth("Bluetooth"), Wired("Headset")
}

/** Camera capture presets (resolution / fps / sender bitrate cap), the mobile equivalent of the web video constraints. */
enum class CameraQuality(val label: String, val width: Int, val height: Int, val fps: Int, val maxBitrate: Int) {
    Low("Low", 320, 240, 15, 250_000),
    Medium("Medium", 640, 480, 24, 700_000),
    High("High", 1280, 720, 30, 1_800_000)
}

/** Screen-share presets; [longSide] caps the longer edge of the captured display. Mirrors the web 720p/1080p x fps choices. */
enum class ScreenQuality(val label: String, val longSide: Int, val fps: Int, val maxBitrate: Int) {
    Saver("Data saver", 960, 10, 600_000),
    Balanced("Balanced", 1280, 15, 1_500_000),
    Sharp("Sharp", 1920, 30, 3_000_000)
}

/**
 * How shared screens are rendered on this device. The SFU forwards one stream per sharer (no simulcast), so this
 * limits local decode/render work and battery rather than the bytes on the wire; [Paused] stops drawing the stream.
 */
enum class ReceiveQuality(val label: String, val fpsReduction: Float?) {
    Full("Full", null), Reduced("Reduced (15 fps)", 15f), Low("Low (5 fps)", 5f), Paused("Paused", 0f)
}

/**
 * Chooses and applies the call audio output (earpiece, speaker, Bluetooth, wired) and keeps the list of
 * available outputs current as headsets connect and disconnect. Uses `setCommunicationDevice` on Android 12+
 * and the legacy speakerphone / SCO calls below that.
 */
class CallAudioRouter(private val context: Context) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val handler = Handler(Looper.getMainLooper())
    private val _routes = MutableStateFlow(listOf(AudioRoute.Speaker))
    private val _current = MutableStateFlow(AudioRoute.Speaker)
    private var previousMode = AudioManager.MODE_NORMAL
    private var previousSpeaker = false
    private var manual = false
    private var active = false

    /** Outputs that exist right now. */
    val routes: StateFlow<List<AudioRoute>> = _routes.asStateFlow()

    /** The output in use. */
    val current: StateFlow<AudioRoute> = _current.asStateFlow()

    private val callback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = refresh()
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = refresh()
    }

    /** Switches the phone into communication mode and picks the best output (headset first, else the speaker). */
    fun start() {
        if (active) return
        active = true
        manual = false
        previousMode = audio.mode
        previousSpeaker = audio.isSpeakerphoneOn
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        audio.registerAudioDeviceCallback(callback, handler)
        refresh()
    }

    /** Restores the audio state from before the call. */
    fun stop() {
        if (!active) return
        active = false
        audio.unregisterAudioDeviceCallback(callback)
        if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice()
        else {
            @Suppress("DEPRECATION") audio.stopBluetoothSco()
            @Suppress("DEPRECATION") audio.isBluetoothScoOn = false
        }
        audio.mode = previousMode
        audio.isSpeakerphoneOn = previousSpeaker
    }

    /** The user picked an output; it sticks until that device goes away. */
    fun select(route: AudioRoute) {
        manual = true
        apply(route)
    }

    private fun types(route: AudioRoute): Set<Int> = when (route) {
        AudioRoute.Earpiece -> setOf(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
        AudioRoute.Speaker -> setOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
        AudioRoute.Bluetooth -> setOfNotNull(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, if (Build.VERSION.SDK_INT >= 31) AudioDeviceInfo.TYPE_BLE_HEADSET else null)
        AudioRoute.Wired -> setOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET)
    }

    private fun refresh() {
        val outputs = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }.toSet()
        val list = buildList {
            if (context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY) || AudioDeviceInfo.TYPE_BUILTIN_EARPIECE in outputs) add(AudioRoute.Earpiece)
            add(AudioRoute.Speaker)
            if (types(AudioRoute.Bluetooth).any { it in outputs }) add(AudioRoute.Bluetooth)
            if (types(AudioRoute.Wired).any { it in outputs }) add(AudioRoute.Wired)
        }
        val previous = _routes.value
        _routes.value = list
        val cur = _current.value
        when {
            // A headset just appeared, or the chosen output vanished: follow the best available one.
            list.any { it !in previous && (it == AudioRoute.Bluetooth || it == AudioRoute.Wired) } ->
                apply(if (AudioRoute.Wired in list) AudioRoute.Wired else AudioRoute.Bluetooth)
            cur !in list -> { manual = false; apply(AudioRoute.Speaker) }
            else -> apply(cur)
        }
    }

    private fun apply(route: AudioRoute) {
        _current.value = route
        if (Build.VERSION.SDK_INT >= 31) {
            val wanted = types(route)
            val device = audio.availableCommunicationDevices.firstOrNull { it.type in wanted }
            if (device != null) audio.setCommunicationDevice(device)
        } else {
            @Suppress("DEPRECATION")
            when (route) {
                AudioRoute.Bluetooth -> { audio.startBluetoothSco(); audio.isBluetoothScoOn = true; audio.isSpeakerphoneOn = false }
                AudioRoute.Speaker -> { audio.stopBluetoothSco(); audio.isBluetoothScoOn = false; audio.isSpeakerphoneOn = true }
                else -> { audio.stopBluetoothSco(); audio.isBluetoothScoOn = false; audio.isSpeakerphoneOn = false }
            }
        }
    }
}
