import { useTranslation } from 'react-i18next';
import { ChevronLeft, Flame, Shield, ShieldCheck, X } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/icon-button';
import { StatusDot } from '@/domains/users/components/status-dot';
import { normalizeStatus } from '@/domains/users/utils/status';

interface WhisperTopbarProps {
	peerId: string;
	peerAvatarId?: string;
	displayName: string;
	status?: string;
	/** True once the session key exists, i.e. there is a safety number to verify. */
	canVerify: boolean;
	verified: boolean;
	/** Mobile shows a back chevron instead of relying on the sidebar. */
	showBack: boolean;
	onVerify: () => void;
	onBurn: () => void;
	onExit: () => void;
}

/** Whisper header: peer with presence, safety-number check, burn and exit. */
export const WhisperTopbar = ({
	peerId,
	peerAvatarId,
	displayName,
	status,
	canVerify,
	verified,
	showBack,
	onVerify,
	onBurn,
	onExit,
}: WhisperTopbarProps) => {
	const { t } = useTranslation();

	return (
		<div className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
			<div className="flex min-w-0 items-center gap-2">
				{showBack && (
					<IconButton label={t('whisper.chat.exit_title')} onClick={onExit} className="-ms-2 h-8 w-8">
						<ChevronLeft size={26} className="rtl:rotate-180" />
					</IconButton>
				)}
				<div className="flex min-w-0 items-center gap-3">
					<div className="pointer-events-none relative shrink-0">
						<Avatar userId={peerId} avatarId={peerAvatarId} size={40} />
						<StatusDot
							status={status}
							className="absolute -bottom-0.5 -end-0.5 z-10 border-2 border-background"
						/>
					</div>
					<div className="pointer-events-none flex min-w-0 flex-col">
						<div className="truncate text-[15px] font-bold leading-tight text-foreground">{displayName}</div>
						<div className="mt-0.5 text-[12px] leading-tight text-muted-foreground">
							{t(`status.${normalizeStatus(status)}`)}
						</div>
					</div>
				</div>
			</div>

			<div className="flex items-center gap-1.5 text-muted-foreground">
				{canVerify && (
					<Button
						type="button"
						variant={verified ? 'secondary' : 'outline'}
						size="sm"
						onClick={onVerify}
						title={t('whisper.safety.title')}
						className="h-9 gap-1.5 text-xs font-semibold"
					>
						{verified ? <ShieldCheck size={16} /> : <Shield size={16} />}
						<span>{verified ? t('whisper.safety.verified') : t('whisper.safety.verify')}</span>
					</Button>
				)}
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onBurn}
					title={t('whisper.chat.burn_title')}
					className="h-9 gap-1.5 border-destructive/20 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
				>
					<Flame size={16} />
					<span className="hidden sm:inline">{t('whisper.chat.burn')}</span>
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onExit}
					title={t('whisper.chat.exit_btn_title')}
					className="h-9 gap-1.5 text-xs font-semibold"
				>
					<X size={16} />
					<span>{t('whisper.chat.exit_btn')}</span>
				</Button>
			</div>
		</div>
	);
};
