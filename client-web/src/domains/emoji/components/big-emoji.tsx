import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAssetUrl } from '@/lib/asset-cache';
import type { EmojiMessageClass } from '../utils/classify-emoji-message';
import { tokenizeEmojiText } from '../utils/emoji-text';
import { useAnimatedEmoji, useCustomEmoji } from '../hooks/use-emoji';
import { CustomEmojiImage, Emoji } from './emoji';

/** Size of the big animated emoji (Telegram shows about this much). */
export const ANIMATED_EMOJI_SIZE = 128;

/** Static jumbo size by how many emoji the message holds: fewer means bigger. */
const JUMBO_SIZE: Record<number, number> = { 1: 64, 2: 52, 3: 44 };

/**
 * A message that is only emoji, shown large and without a bubble. A single emoji with an animation plays its
 * "Cove Moves" animation (tap to replay) and shows the static image until the animation has downloaded; anything
 * else is a row of jumbo static images.
 *
 * @param text - The message text (used for the jumbo row and as the accessible label).
 * @param classification - Result of `classifyEmojiMessage` for this text; must not be `normal`.
 */
export const BigEmoji = memo(function BigEmoji({
	text,
	classification,
}: {
	text: string;
	classification: Exclude<EmojiMessageClass, { kind: 'normal' }>;
}) {
	const { urlFor } = useAnimatedEmoji();
	const { t } = useTranslation();
	const [replay, setReplay] = useState(0);
	const animUrl = classification.kind === 'animated' ? urlFor(classification.key) : undefined;
	const src = useAssetUrl(animUrl);

	if (classification.kind === 'animated' && src) {
		return (
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setReplay((n) => n + 1);
				}}
				title={t('emoji.big.replay')}
				aria-label={`${classification.emoji[0]} ${t('emoji.big.replay')}`}
				className="block w-fit cursor-pointer rounded-md border-none bg-transparent p-0"
			>
				{/* A fresh <img> per tap restarts the animation from its first frame. */}
				<img
					key={replay}
					src={src}
					alt={classification.emoji[0]}
					draggable={false}
					width={ANIMATED_EMOJI_SIZE}
					height={ANIMATED_EMOJI_SIZE}
					style={{ width: ANIMATED_EMOJI_SIZE, height: ANIMATED_EMOJI_SIZE }}
				/>
			</button>
		);
	}

	return <JumboRow text={text} />;
});

/** The static jumbo row: emoji and custom emoji at a size that shrinks as the count grows. */
function JumboRow({ text }: { text: string }) {
	const { names, byName } = useCustomEmoji();
	const tokens = tokenizeEmojiText(text, names).filter((t) => t.type !== 'text');
	const size = JUMBO_SIZE[tokens.length] ?? JUMBO_SIZE[3];
	return (
		<div className="flex w-fit items-center gap-1" dir="ltr">
			{tokens.map((token, i) => {
				if (token.type === 'emoji') return <Emoji key={i} char={token.value} size={size} />;
				if (token.type === 'custom') {
					const item = byName.get(token.name);
					if (item) return <CustomEmojiImage key={i} name={item.name} url={item.url} size={size} />;
				}
				return null;
			})}
		</div>
	);
}
