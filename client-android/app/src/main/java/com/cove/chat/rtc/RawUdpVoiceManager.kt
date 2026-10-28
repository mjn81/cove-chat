package com.cove.chat.rtc

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/**
 * Air-gapped fallback client for voice.mode = "raw_udp" on port 9090.
 * Implements the Cove binary UDP packet protocol matching client-desktop/voice.go
 * and backend/internal/voice/router.go.
 */
class RawUdpVoiceManager {
    companion object {
        const val PACKET_TYPE_REGISTER: Byte = 0
        const val PACKET_TYPE_AUDIO: Byte = 1
        const val PACKET_TYPE_JOIN: Byte = 2
        const val PACKET_TYPE_LEAVE: Byte = 3
        const val ID_LENGTH = 36 // UUID length in bytes
        const val SAMPLE_RATE = 48000
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var socket: DatagramSocket? = null
    private var serverAddr: InetAddress? = null
    private var serverPort: Int = 9090

    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null

    private var isRunning = false
    private var currentChannelId: String? = null
    private var myUserId: String? = null

    fun startVoice(
        host: String,
        port: Int,
        token: String,
        userId: String,
        channelId: String
    ) {
        if (isRunning) return
        isRunning = true
        myUserId = userId
        currentChannelId = channelId
        serverPort = port

        scope.launch {
            try {
                serverAddr = InetAddress.getByName(host)
                socket = DatagramSocket()

                // 1. Send Register packet [0][sessionToken]
                val regData = ByteArray(1 + token.toByteArray().size)
                regData[0] = PACKET_TYPE_REGISTER
                System.arraycopy(token.toByteArray(), 0, regData, 1, token.toByteArray().size)
                socket?.send(DatagramPacket(regData, regData.size, serverAddr, serverPort))

                // 2. Send Join packet [2][channelId (36 bytes)]
                val joinData = ByteArray(1 + ID_LENGTH)
                joinData[0] = PACKET_TYPE_JOIN
                val chIdBytes = channelId.toByteArray()
                System.arraycopy(chIdBytes, 0, joinData, 1, minOf(chIdBytes.size, ID_LENGTH))
                socket?.send(DatagramPacket(joinData, joinData.size, serverAddr, serverPort))

                // 3. Start audio playback and capture loops
                startAudioPlayback()
                startAudioCapture()
                listenIncomingUdp()
            } catch (_: Exception) {
                stopVoice()
            }
        }
    }

    private fun startAudioPlayback() {
        val bufferSize = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .build()
        audioTrack?.play()
    }

    private fun startAudioCapture() {
        val bufferSize = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )
            audioRecord?.startRecording()

            scope.launch {
                val pcmBuffer = ByteArray(2048 * 2) // 2048 samples = 4096 bytes
                val sendBuffer = ByteArray(1 + ID_LENGTH + pcmBuffer.size)
                sendBuffer[0] = PACKET_TYPE_AUDIO

                val uidBytes = (myUserId ?: "").toByteArray()
                System.arraycopy(uidBytes, 0, sendBuffer, 1, minOf(uidBytes.size, ID_LENGTH))

                while (isActive && isRunning) {
                    val read = audioRecord?.read(pcmBuffer, 0, pcmBuffer.size) ?: 0
                    if (read > 0) {
                        System.arraycopy(pcmBuffer, 0, sendBuffer, 1 + ID_LENGTH, read)
                        val packet = DatagramPacket(sendBuffer, 1 + ID_LENGTH + read, serverAddr, serverPort)
                        socket?.send(packet)
                    }
                }
            }
        } catch (_: Exception) {}
    }

    private fun listenIncomingUdp() {
        scope.launch {
            val buf = ByteArray(8192)
            while (isActive && isRunning) {
                try {
                    val packet = DatagramPacket(buf, buf.size)
                    socket?.receive(packet)
                    if (packet.length > 1 + ID_LENGTH && buf[0] == PACKET_TYPE_AUDIO) {
                        // Offset 1 + 36 is the start of raw PCM Int16 audio
                        val audioOffset = 1 + ID_LENGTH
                        val audioLen = packet.length - audioOffset
                        audioTrack?.write(buf, audioOffset, audioLen)
                    }
                } catch (_: Exception) {}
            }
        }
    }

    fun stopVoice() {
        if (!isRunning) return
        isRunning = false

        scope.launch {
            try {
                // Send Leave packet [3][channelId]
                currentChannelId?.let { chId ->
                    val leaveData = ByteArray(1 + ID_LENGTH)
                    leaveData[0] = PACKET_TYPE_LEAVE
                    val chBytes = chId.toByteArray()
                    System.arraycopy(chBytes, 0, leaveData, 1, minOf(chBytes.size, ID_LENGTH))
                    socket?.send(DatagramPacket(leaveData, leaveData.size, serverAddr, serverPort))
                }
            } catch (_: Exception) {}

            audioRecord?.stop()
            audioRecord?.release()
            audioTrack?.stop()
            audioTrack?.release()
            socket?.close()

            audioRecord = null
            audioTrack = null
            socket = null
        }
    }
}
