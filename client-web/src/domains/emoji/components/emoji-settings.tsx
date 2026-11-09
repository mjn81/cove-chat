import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useActiveEmojiStyleId, useAnimatedEnabled, useEmojiStyles } from '../hooks/use-emoji';
import { useEmojiSettings } from '../store/emoji.store';
import { NATIVE_STYLE } from '../utils/emoji-settings';
import { Emoji } from './emoji';

/** Formats a byte count as megabytes for the download hint. */
const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** A short row of sample emoji so the user sees what a style looks like before leaving the setting. */
const SAMPLE = ['😀', '❤️', '👍🏽', '🎉', '🚀'];

/**
 * Emoji preferences for this device: which style to draw emoji with (among the styles the server enabled; the first
 * use of a style downloads it) and the "Animated emoji" switch. Hidden entirely on servers that offer no emoji
 * styles, where the device's own emoji are used as before.
 */
export function EmojiSettings() {
	const { t } = useTranslation();
	const { data: styles } = useEmojiStyles();
	const active = useActiveEmojiStyleId();
	const animated = useAnimatedEnabled();
	const setStyle = useEmojiSettings((s) => s.setStyle);
	const setAnimated = useEmojiSettings((s) => s.setAnimated);
	const options = styles?.enabled_styles ?? [];

	const label = (id: string) => {
		if (id === NATIVE_STYLE) return t('emoji.styles.native');
		const info = styles?.styles.find((s) => s.id === id);
		return info ? `${info.name} (${megabytes(info.sheet_bytes)})` : id;
	};

	return (
		<section className="space-y-5">
			<h3 className="text-lg font-semibold text-foreground">{t('emoji.settings.title')}</h3>
			{options.length > 0 && (
				<div className="space-y-2">
					<Label htmlFor="emoji-style">{t('emoji.settings.style')}</Label>
					<Select value={active} onValueChange={setStyle}>
						<SelectTrigger id="emoji-style" className="max-w-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{options.map((id) => (
								<SelectItem key={id} value={id}>
									{label(id)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="flex items-center gap-2 pt-1" dir="ltr" aria-hidden="true">
						{SAMPLE.map((c) => (
							<Emoji key={c} char={c} size={28} styleId={active} />
						))}
					</div>
					<p className="text-xs text-muted-foreground">{t('emoji.settings.style_hint')}</p>
				</div>
			)}
			<div className="flex items-start justify-between gap-4">
				<div>
					<Label htmlFor="emoji-animated">{t('emoji.settings.animated')}</Label>
					<p className="text-xs text-muted-foreground">{t('emoji.settings.animated_hint')}</p>
				</div>
				<Switch id="emoji-animated" checked={animated} onCheckedChange={setAnimated} />
			</div>
		</section>
	);
}
