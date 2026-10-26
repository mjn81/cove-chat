import * as React from 'react';
import { Signal, SignalHigh, SignalLow, SignalMedium } from 'lucide-react';

import { cn } from '@/lib/utils';
import { pingLevel } from '../utils/ping';

export interface PingSignalProps {
	/** Round-trip time in ms, or `null` while measuring. */
	ping: number | null;
	size?: number;
	className?: string;
}

/** Signal-strength icon coloured by connection quality (pulses while measuring). */
export const PingSignal: React.FC<PingSignalProps> = ({ ping, size = 15, className }) => {
	const base = cn('shrink-0', className);
	switch (pingLevel(ping)) {
		case 'measuring':
			return <Signal size={size} className={cn('animate-pulse text-success', base)} />;
		case 'good':
			return <SignalHigh size={size} className={cn('text-success', base)} />;
		case 'average':
			return <SignalMedium size={size} className={cn('text-warning', base)} />;
		default:
			return <SignalLow size={size} className={cn('text-destructive', base)} />;
	}
};
