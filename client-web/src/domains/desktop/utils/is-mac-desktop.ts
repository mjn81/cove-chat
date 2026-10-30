import { isMac, isWails } from '@/utils/wails';

/** True in the macOS desktop app, where the traffic lights are drawn over the top-left of the web view. */
export const isMacDesktop = (): boolean => isWails() && isMac();
