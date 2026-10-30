import { useEffect } from 'react';
import { EventsOn } from '../../../wailsjs/runtime/runtime';
import { isWails } from '@/utils/wails';
import { lockApp } from '../api/lock.api';
import { useLockStore } from '../store/lock.store';

/** User activity that postpones the idle lock. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Desktop only. Locks the app after `auto_lock_minutes` without input, and reloads the web view whenever the shell
 * reports a lock (idle timer, "Lock now", or the window being hidden to the tray), so no token or decrypted
 * content stays in the renderer's memory.
 */
export function useAutoLock(): void {
	const { enabled, locked, auto_lock_minutes: minutes } = useLockStore((s) => s.status);

	useEffect(() => {
		if (!isWails()) return;
		return EventsOn('app:locked', () => window.location.reload());
	}, []);

	useEffect(() => {
		if (!isWails() || !enabled || locked || minutes <= 0) return;
		let timer: ReturnType<typeof setTimeout>;
		const arm = () => {
			clearTimeout(timer);
			timer = setTimeout(() => void lockApp(), minutes * 60_000);
		};
		arm();
		ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, arm, { passive: true }));
		return () => {
			clearTimeout(timer);
			ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, arm));
		};
	}, [enabled, locked, minutes]);
}
