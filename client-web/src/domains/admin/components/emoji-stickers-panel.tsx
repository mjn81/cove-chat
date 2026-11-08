import { Separator } from '@/components/ui/separator';
import { CustomEmojiSection } from './custom-emoji-section';
import { EmojiSettingsSection } from './emoji-settings-section';
import { ServerPacksSection } from './server-packs-section';
import { UserPacksModeration } from './user-packs-moderation';

/**
 * Admin tab "Emoji and stickers": emoji styles and uploads/quotas, custom emoji, server packs and the moderation
 * list of user packs. Everything here goes through admin routes that the server re-checks (owner counts as admin).
 */
export function EmojiStickersPanel() {
	return (
		<div className="space-y-8">
			<EmojiSettingsSection />
			<Separator />
			<CustomEmojiSection />
			<Separator />
			<ServerPacksSection />
			<Separator />
			<UserPacksModeration />
		</div>
	);
}
