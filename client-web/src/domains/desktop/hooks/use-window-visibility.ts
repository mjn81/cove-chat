import { useEffect } from 'react';

import { useChannelStore } from '@/store/store';
import { isWails } from '@/utils/wails';
import { EventsOn } from '@/wailsjs/runtime/runtime';
import { useWindowVisibilityStore } from '../store/window-visibility.store';

/** The payload of the desktop app's `window:visibility` event. */
interface VisibilityEvent {
	visible: boolean;
}

/**
 * Tracks whether the desktop window is hidden in the tray, for as long as the caller is mounted. While hidden,
 * incoming messages ignore the open conversation (see planMessageNotification). When the window comes back, the
 * open conversation is re-selected so what arrived meanwhile is marked read, as if the user had just opened it.
 */
export function useWindowVisibility(): void {
	useEffect(() => {
		if (!isWails()) return;
		return EventsOn('window:visibility', (e: VisibilityEvent) => {
			useWindowVisibilityStore.getState().setHidden(!e?.visible);
			if (e?.visible) {
				const { activeChannel, setActiveChannel } = useChannelStore.getState();
				if (activeChannel) setActiveChannel(activeChannel);
			}
		});
	}, []);
}
