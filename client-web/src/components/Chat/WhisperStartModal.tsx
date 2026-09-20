import React, { useState } from 'react';
import { Lock, Clock, Zap, AlertCircle } from 'lucide-react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from '@/components/ui/dialog';
import { useWhisperStore } from '@/store/whisperStore';
import type { WhisperExpiryMode } from '@/lib/whisperDb';
import { Avatar } from '../Avatar';

export const WhisperStartModal: React.FC = () => {
	const {
		isStartModalOpen,
		startModalPeer,
		closeStartModal,
		initiateWhisper,
		errorMessage,
		isConnecting,
	} = useWhisperStore();

	const [selectedMode, setSelectedMode] = useState<WhisperExpiryMode>('persistent');

	if (!isStartModalOpen || !startModalPeer) return null;

	const handleStart = async () => {
		await initiateWhisper(startModalPeer.id, startModalPeer.username, selectedMode);
	};

	const options: {
		id: WhisperExpiryMode;
		title: string;
		desc: string;
		icon: React.ReactNode;
		badge?: string;
	}[] = [
		{
			id: 'persistent',
			title: 'No Expiry (Keep History)',
			desc: 'Messages and keys persist in your browser’s private encrypted DB. Zero server storage.',
			icon: <Lock className="w-4 h-4 text-foreground/80" />,
			badge: 'Recommended',
		},
		{
			id: '5m',
			title: '5 Minutes',
			desc: 'Messages automatically self-destruct 5 minutes after being sent.',
			icon: <Clock className="w-4 h-4 text-amber-400" />,
		},
		{
			id: '1h',
			title: '1 Hour',
			desc: 'Messages automatically self-destruct 1 hour after being sent.',
			icon: <Clock className="w-4 h-4 text-amber-400" />,
		},
		{
			id: '24h',
			title: '24 Hours',
			desc: 'Messages automatically self-destruct 24 hours after being sent.',
			icon: <Clock className="w-4 h-4 text-amber-400" />,
		},
		{
			id: 'session_only',
			title: 'Session Only (RAM Only)',
			desc: 'Everything is kept in memory only. Closing the session or tab destroys all data immediately.',
			icon: <Zap className="w-4 h-4 text-violet-400" />,
		},
	];

	return (
		<Dialog open={isStartModalOpen} onOpenChange={(open) => !open && closeStartModal()}>
			<DialogContent className="max-w-md bg-card/95 backdrop-blur-xl border border-border/80 shadow-2xl p-6 rounded-2xl">
				<DialogHeader className="space-y-2">
					<div className="flex items-center gap-3">
						<div className="relative shrink-0">
							<Avatar userId={startModalPeer.id} size={42} />
							<div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground shadow-xs">
								<Lock size={9} />
							</div>
						</div>
						<div>
							<DialogTitle className="text-base font-semibold tracking-tight text-foreground">
								Start Whisper Chat
							</DialogTitle>
							<DialogDescription className="text-xs text-muted-foreground">
								Direct encrypted session with <span className="font-medium text-foreground">{startModalPeer.username}</span>
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div className="bg-secondary/30 border border-border/40 rounded-xl p-3 text-xs text-muted-foreground flex items-start gap-2.5">
						<Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
						<div>
							<p className="font-medium text-foreground">Zero Server Footprint</p>
							<p className="mt-0.5">
								Keys are generated in your browser via ECDH (P-256) and never leave your devices. The server cannot read or store your messages.
							</p>
						</div>
					</div>

					<div className="space-y-2">
						<label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							Message Lifetime
						</label>
						<div className="space-y-2 max-h-60 overflow-y-auto pr-1">
							{options.map((opt) => {
								const isSelected = selectedMode === opt.id;
								return (
									<button
										key={opt.id}
										type="button"
										onClick={() => setSelectedMode(opt.id)}
										className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
											isSelected
												? 'bg-foreground/10 border-foreground/30 shadow-xs ring-1 ring-foreground/20'
												: 'bg-secondary/20 hover:bg-secondary/40 border-border/40 text-foreground'
										}`}
									>
										<div className="mt-0.5 shrink-0">{opt.icon}</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center justify-between gap-2">
												<span className="text-sm font-medium text-foreground">{opt.title}</span>
												{opt.badge && (
													<span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-secondary text-foreground border border-border">
														{opt.badge}
													</span>
												)}
											</div>
											<p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
												{opt.desc}
											</p>
										</div>
									</button>
								);
							})}
						</div>
					</div>

					{errorMessage && (
						<div className="bg-destructive/10 border border-destructive/20 text-destructive text-xs p-3 rounded-xl flex items-center gap-2">
							<AlertCircle className="w-4 h-4 shrink-0" />
							<span>{errorMessage}</span>
						</div>
					)}
				</div>

				<div className="flex items-center justify-end gap-2 pt-2">
					<button
						type="button"
						onClick={closeStartModal}
						className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleStart}
						disabled={isConnecting}
						className="px-4 py-2 text-xs font-semibold text-background bg-foreground hover:bg-foreground/90 rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
					>
						{isConnecting ? 'Starting...' : 'Start Whisper'}
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
