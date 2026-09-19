import { useEffect, useState } from 'react';
import { WifiOff, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/store';

// Avoids a flash of the banner on the very first connect (wsState starts as
// 'disconnected' before the initial handshake completes) — only shows once
// we've actually been connected before and then dropped.
export function ConnectionBanner() {
	const wsState = useAppStore((state) => state.wsState);
	const [everConnected, setEverConnected] = useState(false);

	useEffect(() => {
		if (wsState === 'connected') setEverConnected(true);
	}, [wsState]);

	if (!everConnected || wsState === 'connected') return null;

	return (
		<div className="shrink-0 z-50 flex items-center justify-center gap-2 py-1.5 text-xs font-medium text-white bg-amber-600/95 shadow animate-in fade-in slide-in-from-top-2 duration-200">
			{wsState === 'connecting' ? (
				<>
					<Loader2 size={13} className="animate-spin" />
					<span>Reconnecting…</span>
				</>
			) : (
				<>
					<WifiOff size={13} />
					<span>Connection lost — reconnecting…</span>
				</>
			)}
		</div>
	);
}
