import React from 'react';
import { useTranslation } from 'react-i18next';

import { parseInvite } from '@/domains/channels/utils/invite-message';
import { JoinPreview } from './JoinPreview';

interface InviteMessageProps {
	/** Decrypted body of an `invite` message (JSON). */
	text?: string;
}

/**
 * The body of an `invite` message: a card with the channel and a Join button, never a link. A body that cannot be
 * read (damaged, or still undecrypted) shows a short notice instead of raw JSON.
 *
 * @param text - Decrypted message text.
 */
export const InviteMessage: React.FC<InviteMessageProps> = ({ text }) => {
	const { t } = useTranslation();
	const invite = text ? parseInvite(text) : null;
	if (!invite) {
		return <span className="text-sm text-muted-foreground">{t('channel.invite.unavailable')}</span>;
	}
	return <JoinPreview inviteCode={invite.code} />;
};
