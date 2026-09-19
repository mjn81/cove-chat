/**
 * Detects if the application is running within the Wails desktop environment.
 */
export const isWails = (): boolean => {
	const hasGo = typeof (window as any).go?.main?.App !== 'undefined';
	const hasRuntime = typeof (window as any).runtime !== 'undefined';
	const result = hasGo || hasRuntime;
	// console.log('isWails check:', { hasGo, hasRuntime, result });
	return result;
};

/**
 * Detects if the application is running in a standard web browser (non-Wails).
 */
export const isBrowser = (): boolean => {
	return !isWails();
};

/**
 * Detects if the client is running on macOS / Apple platform.
 */
export const isMac = (): boolean => {
	if (typeof window === 'undefined') return false;
	const nav = window.navigator as any;
	const platform =
		nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || '';
	return /Mac|iPhone|iPod|iPad/i.test(platform);
};

