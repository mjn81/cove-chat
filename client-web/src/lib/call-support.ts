import { hasCapability } from '@/lib/api-standard';
import { isWails } from '@/utils/wails';
import { hasMediaBridge } from '@/rtc/udp-bridge';

/**
 * Whether this build can place calls through the encrypted UDP media path used in air-gapped mode
 * (docs/udp-media.md). Browsers cannot open raw UDP sockets; the desktop app can, through the Go MediaBridge
 * binding, so this is true only inside Wails when that binding exists.
 */
export function hasNativeMediaTransport(): boolean {
	return isWails() && hasMediaBridge();
}

/** Whether calls on a server with these capabilities must use the UDP media manager (desktop on raw_udp). */
export function useUdpMediaTransport(capabilities: readonly string[] | undefined): boolean {
	if (!capabilities || !hasNativeMediaTransport()) return false;
	return !hasCapability(capabilities, 'webrtc_sfu') && hasCapability(capabilities, 'raw_udp_media');
}

/**
 * Decides whether call buttons must be disabled because the server only offers calls over the native UDP media path.
 * Decided from advertised capabilities, never from version numbers (docs/api-standard.md section 6).
 *
 * @param capabilities - The list from `/api/version`, if the server has answered.
 * @param nativeMedia - Whether this client can speak the UDP media protocol; defaults to {@link hasNativeMediaTransport}.
 * @returns true when the server runs `voice.mode = "raw_udp"` (no WebRTC SFU) and this client cannot do native media.
 */
export function callsNeedNativeClient(
	capabilities: readonly string[] | undefined,
	nativeMedia: boolean = hasNativeMediaTransport(),
): boolean {
	if (nativeMedia || !capabilities) return false;
	if (hasCapability(capabilities, 'webrtc_sfu')) return false;
	return hasCapability(capabilities, 'raw_udp_media') || hasCapability(capabilities, 'raw_udp_voice');
}
