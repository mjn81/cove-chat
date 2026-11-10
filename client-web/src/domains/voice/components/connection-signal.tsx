import * as React from 'react';
import { Loader2, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '@/store/app.slice';
import { cn } from '@/lib/utils';
import { connectionLevel, formatPing } from '../utils/ping';
import { PingSignal } from './ping-signal';

/**
 * Signal bars for the WebSocket link (latency of the heartbeat), shown in the sidebar header.
 * Reads the socket state and the latest ping from the app store; the title carries the exact number.
 */
export const ConnectionSignal: React.FC<{ className?: string }> = ({ className }) => {
	const { t } = useTranslation();
	const wsState = useAppStore((s) => s.wsState);
	const latency = useAppStore((s) => s.wsLatency);
	const level = connectionLevel(wsState, latency);

	if (level === 'offline') {
		return <WifiOff size={14} className={cn('shrink-0 text-destructive', className)} aria-label={t('sidebar.connection_offline')} />;
	}
	if (level === 'connecting') {
		return (
			<Loader2 size={14} className={cn('shrink-0 animate-spin text-warning', className)} aria-label={t('sidebar.connection_connecting')} />
		);
	}
	const label = t(`sidebar.ping_${level}`);
	return (
		<span title={latency === null ? label : `${label} · ${formatPing(latency)}`} className="inline-flex">
			<PingSignal ping={latency} size={14} className={className} />
		</span>
	);
};
