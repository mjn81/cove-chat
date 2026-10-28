import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff } from 'lucide-react';
import { useVoiceStore } from '@/store/voiceStore';
import { useChannelStore } from '@/store/store';
import { webRTCManager } from '@/rtc/WebRTCManager';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';

/**
 * Incoming call notification modal for Direct Messages.
 * A flat theme-token card with accept / decline actions and a gentle synthesized ringtone.
 */
export const IncomingCallModal: React.FC = () => {
	const { t } = useTranslation();
	const incomingCall = useVoiceStore((state) => state.incomingCall);
	const dismissIncomingCall = useVoiceStore((state) => state.dismissIncomingCall);
	const channels = useChannelStore((state) => state.channels);
	const setActiveChannel = useChannelStore((state) => state.setActiveChannel);

	const audioCtxRef = useRef<AudioContext | null>(null);
	const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Synthesize a Discord-like gentle chime using Web Audio API
	useEffect(() => {
		if (!incomingCall) return;

		let ctx: AudioContext | null = null;
		try {
			const AudioCtx =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			if (typeof AudioCtx === 'function') {
				ctx = new AudioCtx();
				audioCtxRef.current = ctx;
			}
		} catch {
			/* AudioContext might be restricted */
		}

		const playRingChord = () => {
			if (!ctx || ctx.state === 'suspended') return;
			try {
				const now = ctx.currentTime;
				// Pleasant major third chord (E5, G#5)
				const freqs = [659.25, 830.61];
				freqs.forEach((freq) => {
					if (!ctx) return;
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();
					osc.type = 'sine';
					osc.frequency.setValueAtTime(freq, now);

					gain.gain.setValueAtTime(0.08, now);
					gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

					osc.connect(gain);
					gain.connect(ctx.destination);

					osc.start(now);
					osc.stop(now + 0.65);
				});
			} catch {
				/* ignore audio errors */
			}
		};

		// Play initial ring after a brief delay
		const initialTimer = setTimeout(() => {
			playRingChord();
			ringIntervalRef.current = setInterval(playRingChord, 2200);
		}, 300);

		return () => {
			clearTimeout(initialTimer);
			if (ringIntervalRef.current) {
				clearInterval(ringIntervalRef.current);
				ringIntervalRef.current = null;
			}
			if (ctx) {
				try {
					ctx.close();
				} catch {
					/* ignore */
				}
				audioCtxRef.current = null;
			}
		};
	}, [incomingCall]);

	if (!incomingCall) return null;

	const handleAccept = async () => {
		const targetChannel = channels.find((c) => c.id === incomingCall.channelId);
		dismissIncomingCall();
		if (targetChannel) {
			setActiveChannel(targetChannel);
		}
		await webRTCManager.join(incomingCall.channelId);
	};

	const handleDecline = () => {
		dismissIncomingCall();
	};

	return (
		<AnimatePresence>
			<motion.div
				role="alertdialog"
				aria-label={t('call.incomingVoice')}
				initial={{ opacity: 0, y: -12 }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -12 }}
				transition={{ duration: 0.15, ease: 'easeOut' }}
				className="pointer-events-auto fixed end-4 top-4 z-50 w-[min(340px,calc(100vw-2rem))] select-none rounded-xl border border-border bg-popover p-4 text-foreground shadow-lg shadow-black/25"
			>
				<div className="flex items-center gap-3">
					<Avatar userId={incomingCall.callerId} avatarId={incomingCall.callerAvatarId} size={44} />
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-semibold">{incomingCall.callerUsername}</div>
						<div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
							<Phone size={12} className="animate-pulse text-success" />
							<span>{t('call.incomingVoice')}</span>
						</div>
					</div>
				</div>

				<div className="mt-4 flex gap-2">
					<Button type="button" variant="secondary" className="flex-1 gap-2" onClick={handleDecline}>
						<PhoneOff size={15} className="text-destructive" />
						{t('call.decline')}
					</Button>
					<Button
						type="button"
						className="flex-1 gap-2 bg-success text-success-foreground hover:bg-success/90"
						onClick={handleAccept}
					>
						<Phone size={15} />
						{t('call.accept')}
					</Button>
				</div>
			</motion.div>
		</AnimatePresence>
	);
};
