/**
 * The track before or after the current one in a play queue.
 *
 * @param queue - Tracks in chat order, oldest first.
 * @param currentId - `fileId` of the track that is playing.
 * @param direction - 1 for the next track, -1 for the previous one.
 * @returns the neighbouring track, or null at either end or when the current track is not in the queue.
 */
export function neighbour<T extends { fileId: string }>(queue: T[], currentId: string, direction: 1 | -1): T | null {
	const index = queue.findIndex((t) => t.fileId === currentId);
	if (index < 0) return null;
	return queue[index + direction] ?? null;
}
