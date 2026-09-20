import React, { useState } from 'react';
import { Shield, ShieldCheck, Copy, Check, Info } from 'lucide-react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from '@/components/ui/dialog';
import { useWhisperStore } from '@/store/whisperStore';

export const WhisperSafetyNumberModal: React.FC = () => {
	const {
		isSafetyNumberModalOpen,
		closeSafetyNumberModal,
		activeSession,
		toggleVerified,
	} = useWhisperStore();

	const [copied, setCopied] = useState(false);

	if (!isSafetyNumberModalOpen || !activeSession) return null;

	const groups = activeSession.safetyNumber ? activeSession.safetyNumber.split(' ') : [];

	const handleCopy = () => {
		navigator.clipboard.writeText(activeSession.safetyNumber);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Dialog open={isSafetyNumberModalOpen} onOpenChange={(open) => !open && closeSafetyNumberModal()}>
			<DialogContent className="max-w-md bg-card/95 backdrop-blur-xl border border-border/80 shadow-2xl p-6 rounded-2xl">
				<DialogHeader className="space-y-2">
					<div className="flex items-center gap-2.5">
						<div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
							activeSession.verified
								? 'bg-foreground/15 border-foreground/30 text-foreground'
								: 'bg-secondary border-border text-foreground'
						}`}>
							{activeSession.verified ? (
								<ShieldCheck className="w-5 h-5" />
							) : (
								<Shield className="w-5 h-5" />
							)}
						</div>
						<div>
							<DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
								Verify Safety Number
							</DialogTitle>
							<DialogDescription className="text-xs text-muted-foreground">
								Zero-trust cryptographic verification with {activeSession.peerUsername}
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div className="bg-secondary/30 border border-border/50 rounded-xl p-3.5 text-xs text-muted-foreground space-y-1.5">
						<div className="flex items-center gap-1.5 text-foreground font-medium">
							<Info className="w-3.5 h-3.5 text-primary" />
							<span>Man-in-the-Middle (MITM) Protection</span>
						</div>
						<p className="leading-relaxed">
							To guarantee that no third party or compromised server intercepted your connection, compare these 60 digits with <span className="font-semibold text-foreground">{activeSession.peerUsername}</span> out-of-band (e.g. read them aloud during a call or compare in person).
						</p>
					</div>

					{/* 60-digit number displayed in 4x3 grid */}
					<div className="bg-secondary/50 border border-border/60 rounded-xl p-4 space-y-2">
						<div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
							<span>Cryptographic Fingerprint</span>
							<button
								type="button"
								onClick={handleCopy}
								className="flex items-center gap-1 hover:text-foreground text-primary transition-colors cursor-pointer"
								title="Copy Safety Number"
							>
								{copied ? <Check className="w-3 h-3 text-foreground font-bold" /> : <Copy className="w-3 h-3" />}
								<span>{copied ? 'Copied' : 'Copy'}</span>
							</button>
						</div>

						<div className="grid grid-cols-3 gap-2 font-mono text-center text-sm tracking-widest text-foreground font-semibold py-1">
							{groups.map((group, idx) => (
								<div
									key={idx}
									className="bg-background/60 border border-border/40 rounded-lg py-1.5 px-1 shadow-xs"
								>
									{group}
								</div>
							))}
						</div>

						<div className="text-[10px] text-center text-muted-foreground/70 font-mono tracking-wider pt-1">
							HEX: {activeSession.fingerprintHex || 'N/A'}
						</div>
					</div>

					{/* Verification Toggle */}
					<div className="flex items-center justify-between p-3.5 bg-secondary/30 border border-border/40 rounded-xl">
						<div>
							<p className="text-xs font-semibold text-foreground">
								Mark as Verified
							</p>
							<p className="text-[11px] text-muted-foreground">
								Confirm you have verified this safety number
							</p>
						</div>

						<button
							type="button"
							onClick={toggleVerified}
							className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
								activeSession.verified
									? 'bg-foreground/15 text-foreground border border-foreground/30'
									: 'bg-secondary hover:bg-secondary/80 text-foreground border border-border'
							}`}
						>
							<ShieldCheck className="w-3.5 h-3.5" />
							{activeSession.verified ? 'Verified' : 'Verify'}
						</button>
					</div>
				</div>

				<div className="flex justify-end pt-1">
					<button
						type="button"
						onClick={closeSafetyNumberModal}
						className="px-4 py-2 text-xs font-semibold text-foreground bg-secondary/80 hover:bg-secondary rounded-lg transition-colors cursor-pointer"
					>
						Done
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
};
