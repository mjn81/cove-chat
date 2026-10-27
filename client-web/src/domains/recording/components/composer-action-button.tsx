import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mic, SendHorizontal, Video } from 'lucide-react';

import { useLongPress } from '@/hooks/use-long-press';
import { cn } from '@/lib/utils';
import { loadRecordMode, saveRecordMode, toggleRecordMode, type RecordMode } from '../utils/record-mode';

interface ComposerActionButtonProps {
	/** Text or attachments are waiting: the button becomes "send". */
	hasContent: boolean;
	sending?: boolean;
	disabled?: boolean;
	size: number;
	onSend: () => void;
	onRecordVoice: () => void;
	onRecordVideo: () => void;
	/** Label for the send state (chat and Whisper word it differently). */
	sendLabel: string;
}

/** How long the button must be held to switch voice / video. */
const HOLD_MS = 450;

const buttonClass =
	'group relative flex shrink-0 cursor-pointer select-none items-center justify-center rounded-full p-1 text-muted-foreground transition [-webkit-touch-callout:none] [touch-action:manipulation] hover:bg-secondary/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground';

/**
 * The composer's single action button, like the Android client: with nothing to send it records
 * (tap = start; press and hold flips the icon between microphone and camera, and the choice is
 * remembered), and once something is typed or attached it becomes the send button. One button
 * instead of three keeps the composer from overflowing on phones.
 */
export function ComposerActionButton({
	hasContent,
	sending = false,
	disabled = false,
	size,
	onSend,
	onRecordVoice,
	onRecordVideo,
	sendLabel,
}: ComposerActionButtonProps) {
	const { t } = useTranslation();
	const [mode, setMode] = useState<RecordMode>(loadRecordMode);

	const flipMode = useCallback(() => {
		setMode((current) => {
			const next = toggleRecordMode(current);
			saveRecordMode(next);
			return next;
		});
		// Light haptic tick where supported (Android browsers); a no-op elsewhere.
		navigator.vibrate?.(12);
	}, []);
	const [pressing, setPressing] = useState(false);
	const longPress = useLongPress(flipMode, { delay: HOLD_MS });
	const release = () => setPressing(false);

	if (hasContent || sending) {
		return (
			<button
				type="button"
				onClick={onSend}
				disabled={disabled || sending}
				className={cn(buttonClass, 'text-primary hover:text-primary')}
				title={sendLabel}
				aria-label={sendLabel}
			>
				{sending ? (
					<Loader2 size={size} className="animate-spin text-primary" />
				) : (
					<SendHorizontal size={size} className="transition-transform group-hover:scale-110 rtl:-scale-x-100" />
				)}
			</button>
		);
	}

	const isVideo = mode === 'video';
	const label = isVideo ? t('composer.record_video') : t('chat.record_voice');
	const Icon = isVideo ? Video : Mic;

	return (
		<button
			type="button"
			{...longPress}
			onPointerDown={(e) => {
				longPress.onPointerDown(e);
				setPressing(true);
			}}
			onPointerUp={() => {
				longPress.onPointerUp();
				release();
			}}
			onPointerLeave={() => {
				longPress.onPointerLeave();
				release();
			}}
			onPointerCancel={() => {
				longPress.onPointerCancel();
				release();
			}}
			onClick={isVideo ? onRecordVideo : onRecordVoice}
			disabled={disabled}
			className={buttonClass}
			title={`${label} - ${t('composer.record_hold_hint')}`}
			aria-label={label}
		>
			{/* Subtle hint that a long press does something: a ring that fills while holding... */}
			{pressing && (
				<svg className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 32 32" aria-hidden="true">
					<circle
						cx="16"
						cy="16"
						r="14"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeDasharray="88"
						className="text-primary/70 hold-ring"
						style={{ animationDuration: `${HOLD_MS}ms` }}
					/>
				</svg>
			)}
			<Icon key={mode} size={size} className="animate-in zoom-in-50 duration-150 transition-transform group-hover:scale-110" />
			{/* ...and two tiny dots under the icon showing which mode (voice or video) is active. */}
			<span className="pointer-events-none absolute -bottom-1 start-1/2 flex -translate-x-1/2 gap-[3px] rtl:translate-x-1/2" aria-hidden="true">
				<i className={cn('h-[3px] w-[3px] rounded-full bg-current transition-opacity', isVideo ? 'opacity-25' : 'opacity-80')} />
				<i className={cn('h-[3px] w-[3px] rounded-full bg-current transition-opacity', isVideo ? 'opacity-80' : 'opacity-25')} />
			</span>
		</button>
	);
}
