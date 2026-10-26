import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Clock, Zap, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ModalShell } from '@/components/modal-shell';
import { useWhisperStore } from '@/store/whisperStore';
import type { WhisperExpiryMode } from '@/lib/whisperDb';
import { cn } from '@/lib/utils';

/** Dialog for starting a Whisper (zero-persistence E2EE) session and choosing message lifetime. */
export const WhisperStartModal: React.FC = () => {
	const { t } = useTranslation();
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
			title: t('whisper.start.persistent_title'),
			desc: t('whisper.start.persistent_desc'),
			icon: <Lock className="h-4 w-4 text-foreground/80" />,
			badge: t('whisper.start.recommended'),
		},
		{
			id: '5m',
			title: t('whisper.start.m5_title'),
			desc: t('whisper.start.m5_desc'),
			icon: <Clock className="h-4 w-4 text-warning" />,
		},
		{
			id: '1h',
			title: t('whisper.start.h1_title'),
			desc: t('whisper.start.h1_desc'),
			icon: <Clock className="h-4 w-4 text-warning" />,
		},
		{
			id: '24h',
			title: t('whisper.start.h24_title'),
			desc: t('whisper.start.h24_desc'),
			icon: <Clock className="h-4 w-4 text-warning" />,
		},
		{
			id: 'session_only',
			title: t('whisper.start.session_title'),
			desc: t('whisper.start.session_desc'),
			icon: <Zap className="h-4 w-4 text-primary" />,
		},
	];

	return (
		<ModalShell
			open={isStartModalOpen}
			onOpenChange={(open) => !open && closeStartModal()}
			title={t('whisper.start.title')}
			description={t('whisper.start.subtitle', { name: startModalPeer.username })}
			footer={
				<>
					<Button type="button" variant="ghost" onClick={closeStartModal}>
						{t('common.cancel')}
					</Button>
					<Button type="button" onClick={handleStart} disabled={isConnecting}>
						{isConnecting ? t('whisper.start.starting') : t('whisper.start.start')}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<div className="flex items-start gap-2.5 rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
					<Lock className="mt-0.5 h-4 w-4 shrink-0" />
					<div>
						<p className="font-medium text-foreground">{t('whisper.start.zero_title')}</p>
						<p className="mt-0.5">{t('whisper.start.zero_desc')}</p>
					</div>
				</div>

				<div className="space-y-2" role="radiogroup" aria-label={t('whisper.start.lifetime')}>
					<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						{t('whisper.start.lifetime')}
					</p>
					<div className="max-h-60 space-y-2 overflow-y-auto">
						{options.map((opt) => {
							const isSelected = selectedMode === opt.id;
							return (
								<button
									key={opt.id}
									type="button"
									role="radio"
									aria-checked={isSelected}
									onClick={() => setSelectedMode(opt.id)}
									className={cn(
										'flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-start transition-colors',
										isSelected
											? 'border-primary bg-primary/5'
											: 'border-border hover:bg-accent',
									)}
								>
									<span className="mt-0.5 shrink-0">{opt.icon}</span>
									<span className="min-w-0 flex-1">
										<span className="flex items-center justify-between gap-2">
											<span className="text-sm font-medium text-foreground">{opt.title}</span>
											{opt.badge && <Badge variant="secondary">{opt.badge}</Badge>}
										</span>
										<span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
											{opt.desc}
										</span>
									</span>
								</button>
							);
						})}
					</div>
				</div>

				{errorMessage && (
					<div
						role="alert"
						className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive"
					>
						<AlertCircle className="h-4 w-4 shrink-0" />
						<span>{errorMessage}</span>
					</div>
				)}
			</div>
		</ModalShell>
	);
};
