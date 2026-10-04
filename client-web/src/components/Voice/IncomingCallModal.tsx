import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, PhoneOff } from 'lucide-react';
import { useVoiceStore } from '@/store/voiceStore';
import { useChannelStore } from '@/store/store';
import { webRTCManager } from '@/rtc/WebRTCManager';
import { Avatar } from '../Avatar';

/**
 * Incoming call notification modal for Direct Messages.
 * Matches Discord's incoming call toast with avatar ring animation,
 * accept/decline actions, and gentle synthesized ringtone.
 */
export const IncomingCallModal: React.FC = () => {
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
				initial={{ opacity: 0, y: -20, scale: 0.95 }}
				animate={{ opacity: 1, y: 0, scale: 1 }}
				exit={{ opacity: 0, y: -20, scale: 0.95 }}
				transition={{ duration: 0.2, ease: 'easeOut' }}
				className="fixed top-6 end-6 z-50 w-80 sm:w-92 bg-[#1e1f22]/95 backdrop-blur-xl border border-white/10 shadow-[0_16px_48px_rgba(0,0,0,0.8)] rounded-2xl p-4 sm:p-5 text-white pointer-events-auto select-none"
			>
				<div className="flex items-center gap-3.5">
					{/* Caller Avatar with animated ringing halos */}
					<div className="relative shrink-0 flex items-center justify-center">
						<span className="absolute -inset-1 rounded-full bg-[#23a55a]/30 animate-ping" />
						<div className="relative rounded-full ring-3 ring-[#23a55a] shadow-[0_0_16px_rgba(35,165,90,0.6)]">
							<Avatar
								userId={incomingCall.callerId}
								avatarId={incomingCall.callerAvatarId}
								size={52}
							/>
						</div>
					</div>

					{/* Caller Information */}
					<div className="flex-1 min-w-0 pr-1">
						<h4 className="text-sm font-bold text-white truncate">
							{incomingCall.callerUsername}
						</h4>
						<p className="text-xs text-[#23a55a] font-medium flex items-center gap-1.5 mt-0.5">
							<span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse" />
							Incoming Voice Call...
						</p>
					</div>
				</div>

				{/* Discord Call Actions: Decline & Accept */}
				<div className="flex items-center gap-3 mt-4 pt-1">
					<button
						type="button"
						onClick={handleDecline}
						className="flex-1 py-2.5 px-3 bg-[#da373c] hover:bg-[#be3135] text-white font-semibold text-xs rounded-xl transition-all duration-150 flex items-center justify-center gap-2 shadow-md hover:scale-[1.02] active:scale-98 cursor-pointer"
					>
						<PhoneOff size={15} />
						<span>Decline</span>
					</button>

					<button
						type="button"
						onClick={handleAccept}
						className="flex-1 py-2.5 px-3 bg-[#23a55a] hover:bg-[#1f9250] text-white font-semibold text-xs rounded-xl transition-all duration-150 flex items-center justify-center gap-2 shadow-md hover:scale-[1.02] active:scale-98 cursor-pointer"
					>
						<Phone size={15} />
						<span>Accept</span>
					</button>
				</div>
			</motion.div>
		</AnimatePresence>
	);
};
