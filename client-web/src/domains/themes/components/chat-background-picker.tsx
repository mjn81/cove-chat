import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app.slice';
import { useThemeAssetUrl } from '../hooks/use-theme-asset-url';
import type { ChatBackgroundConfig } from '../types/themes.types';
import { CHAT_PATTERN_IDS, type ChatBackgroundChoice } from '../utils/chat-backgrounds';
import { chatBackgroundStyle, resolveChatBackground } from '../utils/chat-background-style';
import { CHAT_PATTERN_URLS } from '../utils/chat-pattern-assets';
import { definitionFor } from '../utils/theme-settings';

/** Sample strength for the small tiles: louder than in the chat so the doodles are recognisable. */
const SAMPLE_STRENGTH = 0.15;

/** The picture inside one tile. */
function Sample({ config, themeId }: { config: ChatBackgroundConfig; themeId: string }) {
	const imageUrl = useThemeAssetUrl(themeId, config.type === 'image' ? config.asset : null);
	const style = chatBackgroundStyle(config, {
		strength: SAMPLE_STRENGTH,
		patternUrl: config.type === 'pattern' ? CHAT_PATTERN_URLS[config.pattern] : undefined,
		imageUrl,
	});
	if (!style) return null;
	return <div className="pointer-events-none absolute inset-0" style={style} />;
}

/**
 * Chat background choices: none, the active theme's own background (when it has one), and the doodle patterns.
 * The single list of patterns comes from `CHAT_PATTERN_IDS`.
 */
export function ChatBackgroundPicker() {
	const { t } = useTranslation();
	const chatBackground = useAppStore((s) => s.chatBackground);
	const setChatBackground = useAppStore((s) => s.setChatBackground);
	const themeId = useAppStore((s) => s.themeId);
	const customTheme = useAppStore((s) => s.customTheme);

	const theme = definitionFor(themeId, customTheme);
	const themeBackground = theme.chat?.background;
	const options: ChatBackgroundChoice[] = [
		'none',
		...(themeBackground && themeBackground.type !== 'none' ? (['theme'] as const) : []),
		...CHAT_PATTERN_IDS,
	];

	return (
		<div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
			{options.map((id) => {
				const selected = chatBackground === id;
				return (
					<button
						key={id}
						type="button"
						onClick={() => setChatBackground(id)}
						aria-pressed={selected}
						className={cn(
							'flex select-none flex-col gap-1.5 rounded-lg border-2 bg-secondary p-2 transition-colors',
							selected ? 'border-primary' : 'border-transparent hover:bg-secondary/80',
						)}
					>
						<div className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded border border-border/50 bg-background">
							<Sample config={resolveChatBackground(id, theme)} themeId={themeId} />
							{selected && (
								<div className="absolute bottom-1 end-1 z-10 rounded-full bg-primary p-0.5 text-primary-foreground">
									<Check size={10} />
								</div>
							)}
						</div>
						<span className={cn('w-full truncate text-center text-xs font-medium', selected ? 'font-bold text-foreground' : 'text-muted-foreground')}>
							{t(`settings.chat_bg_${id}`)}
						</span>
					</button>
				);
			})}
		</div>
	);
}
