import { beforeEach, describe, expect, it } from 'vitest';
import { useVoiceStore } from './voiceStore';

// leaveVoice() previously only reset activeChannelId/isActive, leaving
// speakingUsers and the just-left channel's participants entry stale. That
// meant switching from channel A (where someone was mid-speech) to channel B
// could show a leftover "speaking" indicator for a user who isn't even in
// the new channel, until a real voice_update overwrote it.

function resetStore() {
	useVoiceStore.setState({
		activeChannelId: null,
		isActive: false,
		isMuted: false,
		isDeafened: false,
		speakingUsers: new Set(),
		participants: {},
		logs: [],
		userVolumes: {},
		userMutes: new Set(),
	});
}

beforeEach(() => {
	resetStore();
});

describe('voiceStore.leaveVoice', () => {
	it('clears speakingUsers so no stale "speaking" indicator survives into the next channel', () => {
		useVoiceStore.getState().joinVoice('channel-a');
		useVoiceStore.setState({ speakingUsers: new Set(['user-x']) });

		useVoiceStore.getState().leaveVoice();

		expect(useVoiceStore.getState().speakingUsers.size).toBe(0);
	});

	it('resets activeChannelId and isActive', () => {
		useVoiceStore.getState().joinVoice('channel-a');

		useVoiceStore.getState().leaveVoice();

		expect(useVoiceStore.getState().activeChannelId).toBeNull();
		expect(useVoiceStore.getState().isActive).toBe(false);
	});

	it('removes the just-left channel from participants so a quick rejoin cannot read stale membership', () => {
		useVoiceStore.getState().joinVoice('channel-a');
		useVoiceStore.getState().updateParticipants('channel-a', ['user-x', 'user-y']);
		useVoiceStore.getState().updateParticipants('channel-b', ['user-z']);

		useVoiceStore.getState().leaveVoice();

		const { participants } = useVoiceStore.getState();
		expect(participants['channel-a']).toBeUndefined();
		// Other channels' cached participant lists are untouched.
		expect(participants['channel-b']).toEqual(['user-z']);
	});

	it('is a safe no-op when called with no active channel', () => {
		expect(() => useVoiceStore.getState().leaveVoice()).not.toThrow();
		expect(useVoiceStore.getState().activeChannelId).toBeNull();
	});
});
