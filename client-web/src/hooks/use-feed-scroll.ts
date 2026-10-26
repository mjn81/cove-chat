import { useCallback, useEffect, useRef, useState } from 'react';

/** Within this many pixels of the bottom the feed counts as "at the bottom" and keeps following new messages. */
const BOTTOM_THRESHOLD_PX = 120;

/**
 * Scroll behaviour for a chat feed: follow new content while the user is at
 * the bottom, and expose a "jump to latest" action once they scroll away.
 *
 * @param itemCount - Number of items rendered; changing it triggers the follow.
 * @returns Refs for the scroll container and its end sentinel, plus state and handlers.
 */
export function useFeedScroll(itemCount: number) {
	const feedRef = useRef<HTMLDivElement>(null);
	const endRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	useEffect(() => {
		if (isAtBottom) endRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [itemCount, isAtBottom]);

	const onScroll = useCallback(() => {
		const el = feedRef.current;
		if (!el) return;
		setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX);
	}, []);

	const scrollToBottom = useCallback(() => {
		endRef.current?.scrollIntoView({ behavior: 'smooth' });
		setIsAtBottom(true);
	}, []);

	return { feedRef, endRef, isAtBottom, onScroll, scrollToBottom };
}
