import { useSyncExternalStore, useCallback } from 'react';
import { voicePlayer, type VoicePlayerState } from '@/lib/voicePlayer';

/** 
 * Subscribe to the singleton VoicePlayerStore using React's useSyncExternalStore.
 * This ensures the component stays in sync with the external state without
 * triggering the "setState synchronously" warning or cascading renders.
 */
export function useVoicePlayer(): VoicePlayerState {
	return useSyncExternalStore(
		(onStoreChange) => {
			const unsub = voicePlayer.subscribe(() => onStoreChange());
			return () => { unsub(); };
		},
		() => voicePlayer.state
	);
}

export type { RepeatMode } from '@/lib/voicePlayer';

/** Returns a stable reference to the voicePlayer API methods. */
export function useVoicePlayerActions() {
	return {
		play:          useCallback((t: Parameters<typeof voicePlayer.play>[0]) => voicePlayer.play(t),  []),
		pause:         useCallback(() => voicePlayer.pause(),       []),
		togglePlay:    useCallback(() => voicePlayer.togglePlay(),  []),
		seek:          useCallback((p: number) => voicePlayer.seek(p), []),
		cycleSpeed:    useCallback(() => voicePlayer.cycleSpeed(),  []),
		setSpeed:      useCallback((s: number) => voicePlayer.setSpeed(s), []),
		setVolume:     useCallback((v: number) => voicePlayer.setVolume(v), []),
		cycleRepeat:   useCallback(() => voicePlayer.cycleRepeat(), []),
		setRepeatMode: useCallback((m: Parameters<typeof voicePlayer.setRepeatMode>[0]) => voicePlayer.setRepeatMode(m), []),
		close:         useCallback(() => voicePlayer.close(),       []),
	};
}
