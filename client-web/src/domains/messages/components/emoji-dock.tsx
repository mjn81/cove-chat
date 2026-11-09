import { Suspense, lazy } from 'react';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useEmojiSettings } from '@/domains/emoji/store/emoji.store';
import { insertIntoComposer, sendStickerFromPanel } from '@/domains/emoji/utils/composer-bridge';
import { useServerCapabilities } from '@/domains/system/api/use-server-capabilities';
import { loadPanel } from '../utils/emoji-panel-loader';
import { DOCK_MIN_WIDTH_QUERY, DOCK_WIDTH } from '../utils/emoji-dock';

const EmojiStickerPanel = lazy(loadPanel);

/**
 * Telegram's side panel mode: on wide windows the emoji and sticker panel docks as a persistent column to the right
 * of the chat, with the same tabs, search and category bar. It stays open while typing and is remembered in the
 * settings. Narrow windows never show it (the composer falls back to the popover), so the chat always keeps its
 * width. Input goes to the open chat's composer through the composer bridge.
 */
export function EmojiDock() {
	const mode = useEmojiSettings((s) => s.panelMode);
	const open = useEmojiSettings((s) => s.dockOpen);
	const setMode = useEmojiSettings((s) => s.setPanelMode);
	const setOpen = useEmojiSettings((s) => s.setDockOpen);
	const wide = useMediaQuery(DOCK_MIN_WIDTH_QUERY);
	const { supports } = useServerCapabilities();

	if (mode !== 'dock' || !open || !wide) return null;
	return (
		<aside className="relative z-10 h-full shrink-0 border-s border-border bg-popover" style={{ width: DOCK_WIDTH }} aria-label="Emoji">
			<Suspense fallback={null}>
				<EmojiStickerPanel
					fill
					stickersEnabled={supports('stickers')}
					onEmoji={insertIntoComposer}
					onSticker={sendStickerFromPanel}
					dock={{
						docked: true,
						onToggle: () => {
							// Back to the popover: leave the docked column.
							setMode('popover');
							setOpen(false);
						},
						onClose: () => setOpen(false),
					}}
				/>
			</Suspense>
		</aside>
	);
}
