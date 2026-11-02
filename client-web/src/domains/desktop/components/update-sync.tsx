import { useDesktopUpdateSync } from '../hooks/use-desktop-update';

/** Mounts the updater subscription once for the whole desktop app; renders nothing. */
export function UpdateSync() {
	useDesktopUpdateSync();
	return null;
}
