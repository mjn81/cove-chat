import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Megaphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useSendNotice } from '../api/use-admin';
import { adminErrorMessage } from '../utils/admin-errors';

/** Mirrors the server's limit (`maxNoticeLen`); the server re-validates. */
const MAX_NOTICE_LENGTH = 2000;

/**
 * Owner-only form that broadcasts a message from the server's Cove account to every user's Cove chat. A
 * confirmation step guards against sending by accident, since a delivered notice cannot be recalled.
 */
export function NoticePanel() {
	const { t } = useTranslation();
	const send = useSendNotice();
	const [text, setText] = useState('');
	const [confirming, setConfirming] = useState(false);
	const trimmed = text.trim();

	const submit = () =>
		send.mutate(trimmed, {
			onSuccess: (res) => {
				setText('');
				toast.success(t('admin.notices.sent', { n: res.recipients }));
				if (res.failed > 0) toast.error(t('admin.notices.failed', { n: res.failed }));
			},
			onError: (err) => toast.error(adminErrorMessage(t, err)),
		});

	return (
		<div className="space-y-4">
			<div className="flex items-start gap-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<Megaphone size={18} />
				</div>
				<div>
					<h3 className="text-base font-semibold text-foreground">{t('admin.notices.title')}</h3>
					<p className="text-xs text-muted-foreground">{t('admin.notices.description')}</p>
				</div>
			</div>

			<Textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				maxLength={MAX_NOTICE_LENGTH}
				rows={6}
				placeholder={t('admin.notices.placeholder')}
				aria-label={t('admin.notices.title')}
				autoComplete="off"
				spellCheck={false}
			/>
			<div className="flex items-center justify-between">
				<span className="text-xs tabular-nums text-muted-foreground">
					{text.length} / {MAX_NOTICE_LENGTH}
				</span>
				<Button type="button" disabled={!trimmed || send.isPending} onClick={() => setConfirming(true)}>
					{t('admin.notices.send')}
				</Button>
			</div>

			<ConfirmModal
				isOpen={confirming}
				onClose={() => setConfirming(false)}
				onConfirm={submit}
				title={t('admin.notices.confirmTitle')}
				message={t('admin.notices.confirmMessage')}
				confirmText={t('admin.notices.send')}
				variant="primary"
			/>
		</div>
	);
}
