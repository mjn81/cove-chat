import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock } from 'lucide-react';
import { useWhisperStore } from '@/store/whisperStore';
import { Avatar } from './Avatar';

export const WhisperIncomingToast: React.FC = () => {
	const { incomingInvite, acceptInvite, rejectInvite, dismissInvite, isConnecting } =
		useWhisperStore();

	if (!incomingInvite) return null;

	const expiryBadge =
		incomingInvite.expiryMode === 'persistent'
			? null
			: incomingInvite.expiryMode === 'session_only'
			? 'Session only'
			: `${incomingInvite.expiryMode} timer`;

	return (
		<AnimatePresence>
			<motion.div
				initial={{ opacity: 0, y: -16, scale: 0.96 }}
				animate={{ opacity: 1, y: 0, scale: 1 }}
				exit={{ opacity: 0, y: -16, scale: 0.96 }}
				transition={{ duration: 0.18, ease: 'easeOut' }}
				className="fixed top-5 right-5 z-50 w-80 sm:w-88 bg-card/95 dark:bg-[#141416]/95 backdrop-blur-xl border border-border/80 shadow-2xl rounded-2xl p-4 text-foreground pointer-events-auto"
			>
				{/* Top Header Row */}
				<div className="flex items-start gap-3">
					{/* Initiator Avatar with subtle lock badge */}
					<div className="relative shrink-0">
						<Avatar
							userId={incomingInvite.initiatorId}
							size={42}
						/>
						<div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground shadow-xs">
							<Lock size={9} />
						</div>
					</div>

					{/* Information */}
					<div className="flex-1 min-w-0 pr-5">
						<div className="flex items-center gap-1.5 flex-wrap">
							<span className="text-sm font-semibold text-foreground truncate">
								{incomingInvite.initiatorUsername}
							</span>
							{expiryBadge && (
								<span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border/50">
									{expiryBadge}
								</span>
							)}
						</div>
						<p className="text-xs text-muted-foreground mt-0.5 leading-snug">
							Incoming Whisper request
						</p>
					</div>

					{/* Dismiss X button */}
					<button
						type="button"
						onClick={dismissInvite}
						className="absolute top-3.5 right-3.5 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition cursor-pointer"
						title="Dismiss"
					>
						<X size={14} />
					</button>
				</div>

				{/* Action Buttons */}
				<div className="flex items-center gap-2 mt-3.5">
					<button
						type="button"
						onClick={() => acceptInvite(incomingInvite)}
						disabled={isConnecting}
						className="flex-1 py-1.5 px-3 bg-foreground text-background font-medium text-xs rounded-lg hover:opacity-90 active:scale-98 transition shadow-xs disabled:opacity-50 cursor-pointer"
					>
						{isConnecting ? 'Connecting...' : 'Accept'}
					</button>
					<button
						type="button"
						onClick={() => rejectInvite(incomingInvite.sessionId)}
						disabled={isConnecting}
						className="py-1.5 px-3 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground font-medium text-xs rounded-lg active:scale-98 transition cursor-pointer disabled:opacity-50"
					>
						Decline
					</button>
				</div>
			</motion.div>
		</AnimatePresence>
	);
};
