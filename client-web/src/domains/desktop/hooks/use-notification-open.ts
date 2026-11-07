import { useEffect } from 'react';

import { useChannelStore } from '@/store/store';
import { isWails } from '@/utils/wails';
import { EventsOn } from '@/wailsjs/runtime/runtime';

/** The target the desktop app sends when a notification popup is clicked (see `notificationTarget` in Go). */
export interface NotificationTarget {
	kind: string;
	channel_id: string;
}

/**
 * Opens the chat a clicked notification is about. Calls and messages carry their channel; a Whisper invite has
 * none (its card is already on screen), so only the window comes forward, which the desktop app has done.
 * Returns whether a chat was opened.
 */
export function openNotificationTarget(target: NotificationTarget): boolean {
	if (!target.channel_id) return false;
	const { channels, setActiveChannel } = useChannelStore.getState();
	const channel = channels.find((c) => c.id === target.channel_id);
	if (!channel) return false;
	setActiveChannel(channel);
	return true;
}

/** Listens for clicks on the desktop app's notification popups for as long as the caller is mounted. */
export function useNotificationOpen(): void {
	useEffect(() => {
		if (!isWails()) return;
		return EventsOn('notification:open', (target: NotificationTarget) => {
			if (target) openNotificationTarget(target);
		});
	}, []);
}
