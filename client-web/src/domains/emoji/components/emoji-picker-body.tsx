import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Dumbbell, Flag, Leaf, Lightbulb, Loader2, Plane, Search, Shapes, Smile, Sparkles, Utensils } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { useActiveEmojiStyleId, useCustomEmoji, useEmojiStyles, useLoadedEmojiStyle } from '../hooks/use-emoji';
import { useEmojiSettings } from '../store/emoji.store';
import type { LoadedEmojiStyle } from '../types/emoji.types';
import { NATIVE_STYLE } from '../utils/emoji-settings';
import { CUSTOM_EMOJI_RE } from '../utils/emoji-text';
import { stepIndex, type GridKey } from '../utils/insert-text';
import { getPickerCategories } from '../utils/picker-cache';
import { searchEmoji, type PickerCategory } from '../utils/picker-data';
import { CustomEmojiImage, EmojiSprite } from './emoji';

const CELL = 36;
const EMOJI_SIZE = 24;
/** Sections drawn on the first paint; the rest follow one per frame so the panel opens at once. */
const FIRST_SECTIONS = 2;

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

/** How an emoji was chosen: with the keyboard the panel keeps focus so arrow keys keep working. */
export interface EmojiPickInfo {
	keyboard: boolean;
}

interface EmojiPickerBodyProps {
	/** Called with the text to insert: the emoji character, or a `:name:` shortcode for a custom emoji. */
	onSelect: (text: string, info: EmojiPickInfo) => void;
	className?: string;
}

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** One emoji button. Memoised: the grid holds about two thousand of them and must not re-render on hover or scroll. */
const Cell = memo(function Cell({ pick, label, char, loaded }: { pick: string; label: string; char?: string; loaded: LoadedEmojiStyle | null }) {
	return (
		<button
			type="button"
			data-pick={pick}
			data-label={label}
			title={label}
			aria-label={label}
			className="flex items-center justify-center rounded-md hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
			style={{ width: CELL, height: CELL }}
		>
			{char ? <EmojiSprite char={char} size={EMOJI_SIZE} loaded={loaded} /> : null}
		</button>
	);
});

/** Skeleton shown only while the very first cold load is in flight. */
function PickerSkeleton() {
	return (
		<div className="flex flex-wrap gap-1 p-2" aria-hidden="true">
			{Array.from({ length: 64 }, (_, i) => (
				<span key={i} className="animate-pulse rounded-md bg-muted" style={{ width: CELL - 4, height: CELL - 4 }} />
			))}
		</div>
	);
}

/** Hover/focus preview: the emoji large with its name. Lives in its own component so hovering never re-renders the grid. */
function usePreviewSlot() {
	const [preview, setPreview] = useState<{ pick: string; label: string } | null>(null);
	return { preview, setPreview };
}

/**
 * The emoji grid: recents, custom emoji, the standard categories drawn from the active style's sprite sheet,
 * search, skin tone, and a switcher among the styles the server enabled.
 *
 * Interaction: clicking an emoji inserts it and the panel stays open; the buttons do not take focus on mouse down, so
 * the composer keeps its caret. Arrow keys, Home and End move between emoji (mirrored in RTL) and Enter/Space pick.
 * Category data comes from a module-level cache and sections are drawn progressively, so reopening is instant.
 *
 * @param onSelect - Receives the text to insert and how it was chosen.
 */
export default function EmojiPickerBody({ onSelect, className }: EmojiPickerBodyProps) {
	const { t } = useTranslation();
	const skin = useEmojiSettings((s) => s.skinTone);
	const setSkin = useEmojiSettings((s) => s.setSkinTone);
	const [categories, setCategories] = useState<{ skin: number; list: PickerCategory[] } | null>(null);
	const [query, setQuery] = useState('');
	const debounced = useDebounce(query.trim(), 120);
	const [visibleSections, setVisibleSections] = useState(FIRST_SECTIONS);
	const [activeSection, setActiveSection] = useState<string>('');
	const [showSkins, setShowSkins] = useState(false);
	const { preview, setPreview } = usePreviewSlot();
	const scrollRef = useRef<HTMLDivElement>(null);
	const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

	const recents = useEmojiSettings((s) => s.recents);
	const addRecent = useEmojiSettings((s) => s.addRecent);
	const setStyle = useEmojiSettings((s) => s.setStyle);
	const activeStyle = useActiveEmojiStyleId();
	const loaded = useLoadedEmojiStyle();
	const { data: styles } = useEmojiStyles();
	const { items: customItems } = useCustomEmoji();

	useEffect(() => {
		let alive = true;
		getPickerCategories(skin).then((list) => alive && setCategories({ skin, list }));
		return () => {
			alive = false;
		};
	}, [skin]);
	const list = categories?.list ?? null;

	// Draw the remaining sections one per frame after the first paint.
	const sectionTotal = (list?.length ?? 0) + 2;
	useEffect(() => {
		if (visibleSections >= sectionTotal) return;
		const id = requestAnimationFrame(() => setVisibleSections((n) => n + 1));
		return () => cancelAnimationFrame(id);
	}, [visibleSections, sectionTotal]);

	const results = useMemo(() => (list && debounced ? searchEmoji(list, debounced) : null), [list, debounced]);
	const customResults = useMemo(
		() => (debounced ? customItems.filter((c) => c.name.includes(debounced.toLowerCase().replace(/\s+/g, '_'))) : []),
		[customItems, debounced],
	);
	const customByName = useMemo(() => new Map(customItems.map((c) => [c.name, c])), [customItems]);

	const cellFor = (entry: string) => {
		const m = CUSTOM_EMOJI_RE.exec(entry);
		if (m && entry === m[0]) {
			const item = customByName.get(m[1]);
			return item ? <CustomCell key={`c:${entry}`} name={item.name} url={item.url} /> : null;
		}
		return <Cell key={entry} pick={entry} label={entry} char={entry} loaded={loaded} />;
	};

	const sections: { id: string; title: string; icon: LucideIcon; cells: React.ReactNode[] }[] = [];
	if (recents.length > 0) sections.push({ id: 'recent', title: t('emoji.picker.recent'), icon: Clock, cells: recents.map(cellFor) });
	if (customItems.length > 0) {
		sections.push({
			id: 'custom',
			title: t('emoji.picker.custom'),
			icon: Sparkles,
			cells: customItems.map((c) => <CustomCell key={`c:${c.name}`} name={c.name} url={c.url} />),
		});
	}
	for (const category of list ?? []) {
		sections.push({
			id: category.id,
			title: t(`emoji.categories.${category.id}`, { defaultValue: category.id }),
			icon: CATEGORY_ICONS[category.id] ?? Smile,
			cells: category.emojis.map((e) => <Cell key={e.id} pick={e.native} label={e.name} char={e.native} loaded={loaded} />),
		});
	}

	const pickFrom = (target: EventTarget | null, keyboard: boolean) => {
		const el = (target as HTMLElement | null)?.closest<HTMLElement>('[data-pick]');
		if (!el?.dataset.pick) return;
		addRecent(el.dataset.pick);
		onSelect(el.dataset.pick, { keyboard });
	};

	const buttons = () => Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-pick]') ?? []);

	const onKeyDown = (e: React.KeyboardEvent) => {
		const all = buttons();
		const index = all.indexOf(document.activeElement as HTMLElement);
		if (index < 0) return;
		const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
		let next = -1;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
			next = stepIndex(index, all.length, e.key as GridKey, rtl);
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			// Geometry: the nearest button one row below or above, closest horizontally.
			const here = all[index].getBoundingClientRect();
			const down = e.key === 'ArrowDown';
			let best = Infinity;
			all.forEach((b, i) => {
				const r = b.getBoundingClientRect();
				const dy = down ? r.top - here.top : here.top - r.top;
				if (dy < 4) return;
				const score = dy * 1000 + Math.abs(r.left - here.left);
				if (score < best) {
					best = score;
					next = i;
				}
			});
		}
		if (next >= 0) {
			e.preventDefault();
			all[next].focus();
			all[next].scrollIntoView({ block: 'nearest' });
		}
	};

	const onScroll = useCallback(() => {
		const box = scrollRef.current;
		if (!box) return;
		const top = box.getBoundingClientRect().top + 8;
		let current = '';
		for (const [id, el] of Object.entries(sectionRefs.current)) {
			if (el && el.getBoundingClientRect().top <= top) current = id;
		}
		setActiveSection((prev) => (prev === current ? prev : current));
	}, []);

	const styleOptions = styles?.enabled_styles ?? [];
	const styleLabel = (id: string) => {
		if (id === NATIVE_STYLE) return t('emoji.styles.native');
		const info = styles?.styles.find((s) => s.id === id);
		return info ? `${info.name} (${megabytes(info.sheet_bytes)})` : id;
	};
	const downloading = activeStyle !== NATIVE_STYLE && !loaded;
	const shown = sections.slice(0, visibleSections);
	const currentSection = activeSection || sections[0]?.id;

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
				<button
					type="button"
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => setShowSkins((v) => !v)}
					title={t('emoji.picker.skin_tone')}
					aria-label={t('emoji.picker.skin_tone')}
					aria-expanded={showSkins}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent"
				>
					<EmojiSprite char={['👋', '👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿'][skin - 1]} size={20} loaded={loaded} />
				</button>
				{styleOptions.length > 1 && (
					<Select value={activeStyle} onValueChange={(v) => setStyle(v)}>
						<SelectTrigger className="h-8 w-[110px] shrink-0 text-xs" aria-label={t('emoji.picker.style')}>
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
			{showSkins && (
				<div className="flex items-center gap-1 border-b border-border px-2 py-1" role="radiogroup" aria-label={t('emoji.picker.skin_tone')}>
					{['👋', '👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿'].map((c, i) => (
						<button
							key={c}
							type="button"
							role="radio"
							aria-checked={skin === i + 1}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => {
								setSkin(i + 1);
								setShowSkins(false);
							}}
							className={cn('flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent', skin === i + 1 && 'bg-accent')}
						>
							<EmojiSprite char={c} size={20} loaded={loaded} />
						</button>
					))}
				</div>
			)}

			<div
				ref={scrollRef}
				className="flex-1 overflow-y-auto p-2 custom-scrollbar"
				onScroll={onScroll}
				onKeyDown={onKeyDown}
				// Pressing an emoji must not move focus out of the composer, so the caret and selection survive.
				onMouseDown={(e) => (e.target as HTMLElement).closest('[data-pick]') && e.preventDefault()}
				onClick={(e) => pickFrom(e.target, e.detail === 0)}
				onMouseOver={(e) => {
					const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
					if (el?.dataset.pick) setPreview({ pick: el.dataset.pick, label: el.dataset.label ?? '' });
				}}
				onMouseLeave={() => setPreview(null)}
				onFocus={(e) => {
					const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
					if (el?.dataset.pick) setPreview({ pick: el.dataset.pick, label: el.dataset.label ?? '' });
				}}
			>
				{!list ? (
					<PickerSkeleton />
				) : results ? (
					results.length + customResults.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">{t('emoji.picker.no_results')}</p>
					) : (
						<div className="flex flex-wrap">
							{customResults.map((c) => (
								<CustomCell key={`c:${c.name}`} name={c.name} url={c.url} />
							))}
							{results.map((e) => (
								<Cell key={e.id} pick={e.native} label={e.name} char={e.native} loaded={loaded} />
							))}
						</div>
					)
				) : (
					shown.map((s) => (
						<section
							key={s.id}
							ref={(el) => {
								sectionRefs.current[s.id] = el;
							}}
							style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 240px' }}
						>
							<h3 className="sticky top-0 z-10 bg-popover py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</h3>
							<div className="flex flex-wrap">{s.cells}</div>
						</section>
					))
				)}
			</div>

			<div className="flex h-9 items-center gap-2 border-t border-border px-3 text-sm" aria-live="polite">
				{preview ? (
					<>
						{CUSTOM_EMOJI_RE.test(preview.pick) ? null : <EmojiSprite char={preview.pick} size={22} loaded={loaded} />}
						<span className="truncate text-muted-foreground">{preview.label}</span>
					</>
				) : (
					<span className="truncate text-muted-foreground/60">{t('emoji.picker.hover_hint')}</span>
				)}
			</div>

			{!results && list && (
				<div className="flex items-center justify-between border-t border-border px-1 py-1">
					{sections.map((s) => (
						<button
							key={s.id}
							type="button"
							title={s.title}
							aria-label={s.title}
							aria-current={currentSection === s.id}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => {
								setVisibleSections(sections.length);
								requestAnimationFrame(() => sectionRefs.current[s.id]?.scrollIntoView({ block: 'start' }));
							}}
							className={cn(
								'flex h-7 flex-1 items-center justify-center rounded-md hover:bg-accent hover:text-foreground',
								currentSection === s.id ? 'bg-accent text-foreground' : 'text-muted-foreground',
							)}
						>
							<s.icon size={16} />
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** A custom emoji cell; picks the `:name:` shortcode. */
const CustomCell = memo(function CustomCell({ name, url }: { name: string; url: string }) {
	return (
		<button
			type="button"
			data-pick={`:${name}:`}
			data-label={`:${name}:`}
			title={`:${name}:`}
			aria-label={`:${name}:`}
			className="flex items-center justify-center rounded-md hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
			style={{ width: CELL, height: CELL }}
		>
			<CustomEmojiImage name={name} url={url} size={EMOJI_SIZE} />
		</button>
	);
});
