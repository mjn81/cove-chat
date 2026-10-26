import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Copy, Check, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/modal-shell';
import { SettingRow } from '@/components/setting-row';
import { useWhisperStore } from '@/store/whisperStore';

/** Dialog showing the Whisper safety number so both people can verify the session out-of-band. */
export const WhisperSafetyNumberModal: React.FC = () => {
	const { t } = useTranslation();
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
		<ModalShell
			open={isSafetyNumberModalOpen}
			onOpenChange={(open) => !open && closeSafetyNumberModal()}
			title={t('whisper.safety.title')}
			description={t('whisper.safety.subtitle', { name: activeSession.peerUsername })}
			footer={
				<Button type="button" variant="secondary" onClick={closeSafetyNumberModal}>
					{t('whisper.safety.done')}
				</Button>
			}
		>
			<div className="space-y-4">
				<div className="space-y-1.5 rounded-md border border-border bg-muted p-3.5 text-xs text-muted-foreground">
					<div className="flex items-center gap-1.5 font-medium text-foreground">
						<Info className="h-3.5 w-3.5 text-primary" />
						<span>{t('whisper.safety.mitm_title')}</span>
					</div>
					<p className="leading-relaxed">
						{t('whisper.safety.mitm_desc', { name: activeSession.peerUsername })}
					</p>
				</div>

				{/* 60-digit number displayed in a 3-column grid */}
				<div className="space-y-2 rounded-md border border-border bg-muted p-4">
					<div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						<span>{t('whisper.safety.fingerprint')}</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={handleCopy}
							className="h-6 gap-1 px-2 text-[11px] text-primary"
						>
							{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
							<span>{copied ? t('whisper.safety.copied') : t('whisper.safety.copy')}</span>
						</Button>
					</div>

					{/* Digits are always left-to-right, even in RTL locales */}
					<div
						dir="ltr"
						className="grid grid-cols-3 gap-2 py-1 text-center font-mono text-sm font-semibold tracking-widest text-foreground"
					>
						{groups.map((group, idx) => (
							<div
								key={idx}
								className="rounded-md border border-border bg-background px-1 py-1.5"
							>
								{group}
							</div>
						))}
					</div>

					<div
						dir="ltr"
						className="pt-1 text-center font-mono text-[10px] tracking-wider text-muted-foreground"
					>
						HEX: {activeSession.fingerprintHex || 'N/A'}
					</div>
				</div>

				<SettingRow
					className="rounded-md border border-border bg-muted px-3.5"
					title={t('whisper.safety.mark_verified')}
					description={t('whisper.safety.mark_verified_desc')}
				>
					<Button
						type="button"
						size="sm"
						variant={activeSession.verified ? 'default' : 'secondary'}
						onClick={toggleVerified}
					>
						<ShieldCheck className="h-3.5 w-3.5" />
						{activeSession.verified ? t('whisper.safety.verified') : t('whisper.safety.verify')}
					</Button>
				</SettingRow>
			</div>
		</ModalShell>
	);
};
