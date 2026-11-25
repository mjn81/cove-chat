// What the SharedWorker has to remember for tabs that join an already open socket.
//
// The server sends channel keys, ongoing calls and pending whisper invites only when a socket connects (or when
// they change), while the worker keeps its socket open across reloads and new tabs. Each tab holds this state only
// in memory, so without a replay a tab that reuses the socket shows [encrypted] messages and misses calls and
// invites. Memory only, same as in the tabs: never persisted, and cleared as soon as the socket (and with it the
// session) ends.

/** How long the server holds an unanswered invite (`pendingWhisperTTL` in backend/internal/ws/hub.go). */
const PENDING_INVITE_TTL_MS = 30 * 60_000;

/** The parts of a WebSocket event the cache looks at. */
export interface ReplayableEvent {
	type?: string;
	payload?: { channel_id?: string; session_id?: string; users?: unknown };
}

/** Creates an empty cache of the connection state that late-joining tabs need. */
export function createReplayCache() {
	const channelKeys = new Map<string, ReplayableEvent>();
	const calls = new Map<string, ReplayableEvent>();
	const invites = new Map<string, { event: ReplayableEvent; receivedAt: number }>();

	return {
		/** Records an event the server sent. */
		inbound(event: ReplayableEvent): void {
			const { channel_id: channelId, session_id: sessionId, users } = event.payload ?? {};
			switch (event.type) {
				case 'channel_key':
					if (channelId) channelKeys.set(channelId, event);
					break;
				case 'voice_update':
					if (!channelId) break;
					if (Array.isArray(users) && users.length > 0) calls.set(channelId, event);
					else calls.delete(channelId);
					break;
				case 'channel_delete':
					if (!channelId) break;
					channelKeys.delete(channelId);
					calls.delete(channelId);
					break;
				case 'whisper_init':
					if (sessionId) invites.set(sessionId, { event, receivedAt: Date.now() });
					break;
				case 'whisper_close':
				case 'whisper_error':
					if (sessionId) invites.delete(sessionId);
					break;
			}
		},
		/** Records an event a tab sends: answering an invite is never echoed back, so it is only visible here. */
		outbound(event: ReplayableEvent): void {
			const sessionId = event.payload?.session_id;
			if (!sessionId) return;
			if (event.type === 'whisper_accept' || event.type === 'whisper_reject' || event.type === 'whisper_close') {
				invites.delete(sessionId);
			}
		},
		/** The events to deliver, in order, to a tab that just joined. */
		events(): ReplayableEvent[] {
			const oldest = Date.now() - PENDING_INVITE_TTL_MS;
			for (const [id, invite] of invites) {
				if (invite.receivedAt < oldest) invites.delete(id);
			}
			return [...channelKeys.values(), ...calls.values(), ...[...invites.values()].map((i) => i.event)];
		},
		clear(): void {
			channelKeys.clear();
			calls.clear();
			invites.clear();
		},
	};
}
