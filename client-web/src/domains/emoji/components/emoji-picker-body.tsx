import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Dumbbell, Flag, Leaf, Lightbulb, Loader2, Plane, Search, Shapes, Smile, Sparkles, Utensils } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { useActiveEmojiStyleId, useCustomEmoji, useEmojiStyles, useLoadedEmojiStyle } from '../hooks/use-emoji';
import { useEmojiSettings } from '../store/emoji.store';
import { CUSTOM_EMOJI_RE } from '../utils/emoji-text';
import { NATIVE_STYLE } from '../utils/emoji-settings';
import { buildCategories, searchEmoji, type PickerCategory, type RawEmojiData } from '../utils/picker-data';
import { CustomEmojiImage, EmojiSprite } from './emoji';

/** Cell size of the grid in px. */
const CELL = 36;
const EMOJI_SIZE = 24;

const CATEGORY_ICONS: Record<string, LucideIcon> = {
	people: Smile,
	nature: Leaf,
	foods: Utensils,
	activity: Dumbbell,
	places: Plane,
	objects: Lightbulb,
	symbols: Shapes,
	flags: Flag,
};

interface EmojiPickerBodyProps {
	/** Called with the text to insert: the emoji character, or a `:name:` shortcode for a custom emoji. */
	onSelect: (text: string) => void;
	className?: string;
}

/** Formats a byte count for the style download hint. */
const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * The emoji grid: recents, custom emoji, the standard categories drawn from the active style's sprite sheet,
 * search, and a switcher among the styles the server enabled. The emoji-mart dataset (names, keywords) is loaded
 * on demand, so this whole component lives in a lazy chunk and is not part of first load.
 *
 * @param onSelect - Receives the text to insert.
 */
export default function EmojiPickerBody({ onSelect, className }: EmojiPickerBodyProps) {
	const { t } = useTranslation();
	const [categories, setCategories] = useState<PickerCategory[] | null>(null);
	const [query, setQuery] = useState('');
	const debounced = useDebounce(query.trim(), 150);
	const scrollRef = useRef<HTMLDivElement>(null);
	const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

	const recents = useEmojiSettings((s) => s.recents);
	const addRecent = useEmojiSettings((s) => s.addRecent);
	const setStyle = useEmojiSettings((s) => s.setStyle);
	const activeStyle = useActiveEmojiStyleId();
	const loaded = useLoadedEmojiStyle();
	const { data: styles } = useEmojiStyles();
	const { items: customItems, byName } = useCustomEmoji();

	useEffect(() => {
		let alive = true;
		import('@emoji-mart/data').then((m) => {
			if (alive) setCategories(buildCategories(m.default as unknown as RawEmojiData));
		});
		return () => {
			alive = false;
		};
	}, []);

	const results = useMemo(
		() => (categories && debounced ? searchEmoji(categories, debounced) : null),
		[categories, debounced],
	);
	const customResults = useMemo(
		() => (debounced ? customItems.filter((c) => c.name.includes(debounced.toLowerCase().replace(/\s+/g, '_'))) : []),
		[customItems, debounced],
	);

	const pick = (text: string) => {
		addRecent(text);
		onSelect(text);
	};

	const renderChar = (char: string, label: string) => (
		<button
			key={char}
			type="button"
			title={label}
			aria-label={label}
			onClick={() => pick(char)}
			className="flex items-center justify-center rounded-md hover:bg-accent"
			style={{ width: CELL, height: CELL }}
		>
			<EmojiSprite char={char} size={EMOJI_SIZE} loaded={loaded} />
		</button>
	);

	const renderCustom = (name: string) => {
		const item = byName.get(name);
		if (!item) return null;
		return (
			<button
				key={`c:${name}`}
				type="button"
				title={`:${name}:`}
				aria-label={`:${name}:`}
				onClick={() => pick(`:${name}:`)}
				className="flex items-center justify-center rounded-md hover:bg-accent"
				style={{ width: CELL, height: CELL }}
			>
				<CustomEmojiImage name={item.name} url={item.url} size={EMOJI_SIZE} />
			</button>
		);
	};

	const renderRecent = (entry: string) => {
		const m = CUSTOM_EMOJI_RE.exec(entry);
		return m && entry === m[0] ? renderCustom(m[1]) : renderChar(entry, entry);
	};

	const sections: { id: string; title: string; icon: LucideIcon; cells: React.ReactNode[] }[] = [];
	if (recents.length > 0) {
		sections.push({ id: 'recent', title: t('emoji.picker.recent'), icon: Clock, cells: recents.map(renderRecent) });
	}
	if (customItems.length > 0) {
		sections.push({
			id: 'custom',
			title: t('emoji.picker.custom'),
			icon: Sparkles,
			cells: customItems.map((c) => renderCustom(c.name)),
		});
	}
	for (const category of categories ?? []) {
		sections.push({
			id: category.id,
			title: t(`emoji.categories.${category.id}`, { defaultValue: category.id }),
			icon: CATEGORY_ICONS[category.id] ?? Smile,
			cells: category.emojis.map((e) => renderChar(e.native, e.name)),
		});
	}

	const styleOptions = styles?.enabled_styles ?? [];
	const styleLabel = (id: string) => {
		if (id === NATIVE_STYLE) return t('emoji.styles.native');
		const info = styles?.styles.find((s) => s.id === id);
		return info ? `${info.name} (${megabytes(info.sheet_bytes)})` : id;
	};
	const downloading = activeStyle !== NATIVE_STYLE && !loaded;

	return (
		<div
			className={cn('flex h-[380px] w-full flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground', className)}
		>
			<div className="flex items-center gap-2 border-b border-border p-2">
				<div className="relative min-w-0 flex-1">
					<Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t('emoji.picker.search')}
						aria-label={t('emoji.picker.search')}
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="off"
						spellCheck={false}
						className="h-8 ps-8 text-sm"
					/>
				</div>
				{styleOptions.length > 1 && (
					<Select value={activeStyle} onValueChange={(v) => setStyle(v)}>
						<SelectTrigger className="h-8 w-[120px] shrink-0 text-xs" aria-label={t('emoji.picker.style')}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{styleOptions.map((id) => (
								<SelectItem key={id} value={id}>
									{styleLabel(id)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				{downloading && <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" aria-label={t('emoji.picker.downloading')} />}
			</div>

			<div ref={scrollRef} className="flex-1 overflow-y-auto p-2 custom-scrollbar">
				{!categories ? (
					<div className="flex h-full items-center justify-center text-muted-foreground">
						<Loader2 size={18} className="animate-spin" />
					</div>
				) : results ? (
					results.length + customResults.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">{t('emoji.picker.no_results')}</p>
					) : (
						<div className="flex flex-wrap">
							{customResults.map((c) => renderCustom(c.name))}
							{results.map((e) => renderChar(e.native, e.name))}
						</div>
					)
				) : (
					sections.map((s) => (
						<section
							key={s.id}
							ref={(el) => {
								sectionRefs.current[s.id] = el;
							}}
							style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 240px' }}
						>
							<h3 className="sticky top-0 z-10 bg-popover py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								{s.title}
							</h3>
							<div className="flex flex-wrap">{s.cells}</div>
						</section>
					))
				)}
			</div>

			{!results && categories && (
				<div className="flex items-center justify-between border-t border-border px-1 py-1">
					{sections.map((s) => (
						<button
							key={s.id}
							type="button"
							title={s.title}
							aria-label={s.title}
							onClick={() => sectionRefs.current[s.id]?.scrollIntoView({ block: 'start' })}
							className="flex h-7 flex-1 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							<s.icon size={16} />
						</button>
					))}
				</div>
			)}
		</div>
	);
}
