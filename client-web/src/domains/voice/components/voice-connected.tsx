import { useTranslation } from 'react-i18next';
import { PhoneOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/icon-button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { webRTCManager } from '@/rtc/WebRTCManager';
import { cn } from '@/lib/utils';
import { PingSignal } from './ping-signal';
import { formatPing, pingLevel } from '../utils/ping';

interface VoiceConnectedProps {
	/** Round-trip time in ms, or `null` while measuring. */
	ping: number | null;
	/** Display name of the channel the call is in. */
	channelName: string;
}

const LEVEL_TEXT_CLASS = {
	measuring: 'text-muted-foreground',
	good: 'text-success',
	average: 'text-warning',
	poor: 'text-destructive',
} as const;

/** Wide "Voice Connected" strip above the user footer, with latency tooltip and disconnect. */
export const VoiceConnectedBar = ({ ping, channelName }: VoiceConnectedProps) => {
	const { t } = useTranslation();
	const level = pingLevel(ping);

	return (
		<div className="flex select-none items-center justify-between border-t border-border/40 bg-popover px-3 py-2">
			<div className="flex min-w-0 items-center gap-2">
				<TooltipProvider delayDuration={150}>
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="flex cursor-pointer items-center justify-center rounded p-0.5 transition-colors hover:bg-accent">
								<PingSignal ping={ping} size={15} />
							</div>
						</TooltipTrigger>
						<TooltipContent side="top" className="text-xs font-medium">
							<div className="font-semibold text-foreground">
								{t(`sidebar.ping_${level}`)}
							</div>
							<div className="mt-0.5 text-[11px] text-muted-foreground">
								{t('sidebar.ping_label')}{' '}
								<span className={cn(LEVEL_TEXT_CLASS[level], level !== 'measuring' && 'font-bold')}>
									{ping !== null ? formatPing(ping) : t('sidebar.measuring')}
								</span>
							</div>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
				<div className="flex min-w-0 flex-col leading-tight">
					<span className="text-xs font-bold tracking-tight text-success">
						{t('sidebar.voice_connected')}
					</span>
					<span className="truncate text-[11px] text-muted-foreground" title={channelName}>
						{channelName}
						{ping !== null && (
							<span className="ms-1 font-mono text-[10px] text-muted-foreground/70" dir="ltr">
								/ {formatPing(ping, true)}
							</span>
						)}
					</span>
				</div>
			</div>
			<IconButton
				label={t('sidebar.disconnect')}
				tone="destructive"
				onClick={() => webRTCManager.leave()}
				className="h-7 w-7"
			>
				<PhoneOff size={14} />
			</IconButton>
		</div>
	);
};

/** Icon-only disconnect button for the collapsed sidebar rail, showing call quality. */
export const CollapsedVoiceButton = ({ ping, channelName }: VoiceConnectedProps) => {
	const { t } = useTranslation();

	return (
		<TooltipProvider delayDuration={0}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 rounded-md p-0 hover:bg-destructive/10"
						onClick={() => webRTCManager.leave()}
						aria-label={t('sidebar.disconnect')}
					>
						<PingSignal ping={ping} size={16} className="pointer-events-none" />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="right" className="text-xs">
					<div className="font-semibold text-foreground">{channelName}</div>
					<div className="mt-0.5 flex items-center gap-1 text-[11px] text-success">
						<span>{t('sidebar.voice_connected')}</span>
						<span className="font-mono text-muted-foreground" dir="ltr">
							({ping !== null ? formatPing(ping, true) : 'RTC'})
						</span>
					</div>
					<div className="mt-1 border-t border-border/40 pt-1 text-[10px] text-muted-foreground/80">
						{t('sidebar.click_to_disconnect')}
					</div>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};
