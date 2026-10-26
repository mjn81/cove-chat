/** Messages from one sender closer together than this share a single avatar/name header. */
const GROUP_WINDOW_MS = 300_000; // 5 minutes

interface Timed {
	senderId: string;
	sentAt: number;
}

/**
 * Whether `curr` continues the sender burst started by `prev`, so the row can
 * hide its avatar and name.
 *
 * @param prev - Previous message in the feed, if any.
 * @param curr - Message being rendered.
 */
export function isSameSenderBurst(prev: Timed | undefined, curr: Timed): boolean {
	if (!prev) return false;
	return prev.senderId === curr.senderId && Math.abs(curr.sentAt - prev.sentAt) < GROUP_WINDOW_MS;
}
