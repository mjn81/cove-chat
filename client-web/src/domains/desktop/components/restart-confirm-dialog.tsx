import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/modal-shell';
import type { InstallUpdateControls } from '../hooks/use-desktop-update';

/**
 * Confirmation shown before restarting for an update while a call is running or a message is unsent.
 * Nothing restarts until the user presses the confirm button.
 */
export function RestartConfirmDialog({
	controls,
	version,
}: {
	controls: InstallUpdateControls;
	version: string;
}) {
	const { t } = useTranslation();
	const { guard, confirmOpen, setConfirmOpen, confirm } = controls;
	const call = guard === 'call' || guard === 'call_and_draft';
	const draft = guard === 'draft' || guard === 'call_and_draft';

	return (
		<ModalShell
			open={confirmOpen}
			onOpenChange={setConfirmOpen}
			title={t('desktopUpdate.confirm.title')}
			description={t('desktopUpdate.confirm.body', { version })}
			size="sm"
			footer={
				<>
					<Button variant="ghost" onClick={() => setConfirmOpen(false)}>
						{t('common.cancel')}
					</Button>
					<Button variant="destructive" onClick={confirm}>
						{t('desktopUpdate.confirm.action')}
					</Button>
				</>
			}
		>
			<ul className="space-y-1 text-sm text-foreground">
				{call && <li>{t('desktopUpdate.confirm.call')}</li>}
				{draft && <li>{t('desktopUpdate.confirm.draft')}</li>}
			</ul>
		</ModalShell>
	);
}
