import { EventsOn } from '@/wailsjs/runtime/runtime';
import type { CallMediaJoinRequest, CallMediaJoinResponse } from '@/ws';
import { base64ToBatch, batchToBase64, packFrames, unpackFrames, type PackedFrame } from './media-batch';

/** Surface of the Go MediaBridge (client-desktop/media_bridge.go) as the manager needs it; fakeable in tests. */
export interface MediaBridge {
	begin(): Promise<CallMediaJoinRequest>;
	complete(serverAddr: string, resp: CallMediaJoinResponse, channelId: string, userId: string): Promise<void>;
	sendFrames(frames: readonly PackedFrame[]): Promise<void>;
	requestKeyframe(src: number, kind: number): Promise<void>;
	close(): Promise<void>;
	onFrames(cb: (frames: PackedFrame[]) => void): () => void;
	onKeyframeRequest(cb: (kind: number) => void): () => void;
}

interface GoMediaBridge {
	Begin(): Promise<CallMediaJoinRequest>;
	Complete(addr: string, resp: CallMediaJoinResponse, channel: string, user: string): Promise<void>;
	SendFrames(batch: string): Promise<void>;
	RequestKeyframe(src: number, kind: number): Promise<void>;
	Close(): Promise<void>;
}

function goBridge(): GoMediaBridge | null {
	const w = window as unknown as { go?: { main?: { MediaBridge?: GoMediaBridge } } };
	return w.go?.main?.MediaBridge ?? null;
}

/** Whether the Wails binding for UDP media exists (false in browsers and in older desktop builds). */
export function hasMediaBridge(): boolean {
	return goBridge() !== null;
}

/**
 * Wraps the Wails binding and events in the {@link MediaBridge} interface.
 * @throws Error when the binding is missing.
 */
export function createWailsMediaBridge(): MediaBridge {
	const go = goBridge();
	if (!go) throw new Error('media bridge unavailable');
	return {
		begin: () => go.Begin(),
		complete: (a, r, c, u) => go.Complete(a, r, c, u),
		sendFrames: (frames) => go.SendFrames(batchToBase64(packFrames(frames))),
		requestKeyframe: (s, k) => go.RequestKeyframe(s, k),
		close: () => go.Close(),
		onFrames: (cb) => EventsOn('media:frames', (b64: string) => cb(unpackFrames(base64ToBatch(b64)))),
		onKeyframeRequest: (cb) => EventsOn('media:keyframe', (k: number) => cb(k)),
	};
}
