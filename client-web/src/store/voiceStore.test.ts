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

describe('voiceStore handledCallChannels persistence', () => {
	it('persists handled call channels to sessionStorage upon dismissIncomingCall', () => {
		useVoiceStore.setState({
			incomingCall: {
				channelId: 'dm-123',
				callerId: 'user-caller',
				callerUsername: 'Caller',
				timestamp: Date.now(),
			},
		});

		useVoiceStore.getState().dismissIncomingCall();

		expect(useVoiceStore.getState().handledCallChannels.has('dm-123')).toBe(true);
		expect(sessionStorage.getItem('cove_handled_calls')).toContain('dm-123');
	});

	it('persists handled call channels to sessionStorage upon leaveVoice', () => {
		useVoiceStore.getState().joinVoice('dm-456');
		useVoiceStore.getState().leaveVoice();

		expect(useVoiceStore.getState().handledCallChannels.has('dm-456')).toBe(true);
		expect(sessionStorage.getItem('cove_handled_calls')).toContain('dm-456');
	});

	it('removes channel from handledCallChannels and sessionStorage upon resetHandledCall', () => {
		useVoiceStore.getState().markCallHandled('dm-789');
		expect(useVoiceStore.getState().handledCallChannels.has('dm-789')).toBe(true);

		useVoiceStore.getState().resetHandledCall('dm-789');
		expect(useVoiceStore.getState().handledCallChannels.has('dm-789')).toBe(false);
		expect(sessionStorage.getItem('cove_handled_calls')).not.toContain('dm-789');
	});
});

describe('voiceStore screen share spotlighting and mute tracking', () => {
	it('switches spotlight to remote user when remote user starts streaming while local user is already streaming', () => {
		useVoiceStore.setState({
			isScreenSharing: true,
			spotlightStreamId: 'local',
		});

		// Bob starts streaming
		useVoiceStore.getState().setTrackState('bob-123', 'screen', true);

		expect(useVoiceStore.getState().spotlightStreamId).toBe('bob-123');
		expect(useVoiceStore.getState().participantTrackStates['bob-123']?.screen).toBe(true);
	});

	it('reverts spotlight back to local screen share when remote user stops streaming', () => {
		useVoiceStore.setState({
			isScreenSharing: true,
			spotlightStreamId: 'bob-123',
		});

		// Bob stops streaming
		useVoiceStore.getState().setTrackState('bob-123', 'screen', false);

		expect(useVoiceStore.getState().spotlightStreamId).toBe('local');
	});

	it('tracks remote participant audio mute state accurately', () => {
		useVoiceStore.getState().setTrackState('alice-456', 'audio', false);
		expect(useVoiceStore.getState().participantTrackStates['alice-456']?.audio).toBe(false);

		useVoiceStore.getState().setTrackState('alice-456', 'audio', true);
		expect(useVoiceStore.getState().participantTrackStates['alice-456']?.audio).toBe(true);
	});
});
