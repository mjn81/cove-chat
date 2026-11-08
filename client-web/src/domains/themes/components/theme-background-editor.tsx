import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ImageEditor } from '@/components/ImageEditor';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { compressImageFile } from '@/utils/file';
import type { ChatBackgroundConfig, ChatImageFit, ThemeAsset } from '../types/themes.types';
import { fitBackgroundImage } from '../utils/background-image';
import { CHAT_PATTERN_IDS } from '../utils/chat-backgrounds';
import { issueMessage } from '../utils/issue-message';
import { HslColorPicker } from './hsl-color-picker';

type BackgroundKind = ChatBackgroundConfig['type'];

const KINDS: readonly BackgroundKind[] = ['none', 'pattern', 'color', 'gradient', 'image'];
const FITS: readonly ChatImageFit[] = ['cover', 'contain', 'tile'];

/** Fallback colours when a kind is first chosen: a mid colour that reads under both light and dark text. */
const DEFAULT_COLOR = '220 10% 50%';

interface ThemeBackgroundEditorProps {
	background: ChatBackgroundConfig;
	image: ThemeAsset | null;
	onBackground: (config: ChatBackgroundConfig) => void;
	/** A new image (also switches the background to it) or `null` to drop it. */
	onImage: (asset: ThemeAsset | null) => void;
}

/** Segmented choice buttons. */
function Choice<T extends string>({
	options,
	value,
	onChange,
	label,
}: {
	options: readonly T[];
	value: T;
	onChange: (v: T) => void;
	label: (v: T) => string;
}) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{options.map((o) => (
				<button
					key={o}
					type="button"
					aria-pressed={value === o}
					onClick={() => onChange(o)}
					className={cn(
						'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
						value === o ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground',
					)}
				>
					{label(o)}
				</button>
			))}
		</div>
	);
}

/**
 * The chat background part of the editor: none, a built-in pattern, a flat colour, a gradient, or an image. Images
 * are cropped with the app's `ImageEditor`, re-encoded with `compressImageFile` until they fit the 2 MB limit, and
 * checked (PNG, JPEG or WebP by magic bytes) before they are kept.
 */
export function ThemeBackgroundEditor({ background, image, onBackground, onImage }: ThemeBackgroundEditorProps) {
	const { t } = useTranslation();
	const fileInput = useRef<HTMLInputElement>(null);
	const [cropFile, setCropFile] = useState<File | null>(null);

	const choose = (kind: BackgroundKind) => {
		switch (kind) {
			case 'none':
				return onBackground({ type: 'none' });
			case 'pattern':
				return onBackground({ type: 'pattern', pattern: background.type === 'pattern' ? background.pattern : CHAT_PATTERN_IDS[0] });
			case 'color':
				return onBackground({ type: 'color', color: background.type === 'color' ? background.color : DEFAULT_COLOR });
			case 'gradient':
				return onBackground(
					background.type === 'gradient' ? background : { type: 'gradient', from: '220 10% 44%', to: '220 10% 56%', angle: 160 },
				);
			case 'image':
				if (image) onImage(image);
				else fileInput.current?.click();
		}
	};

	async function handleCropped(blob: Blob, mime: string) {
		const result = await fitBackgroundImage(async (side, quality) => {
			const compressed = await compressImageFile(new File([blob], 'background', { type: mime }), side, quality);
			return new Uint8Array(await compressed.arrayBuffer());
		});
		if (result.ok) onImage(result.asset);
		else toast.error(issueMessage(t, { code: result.code }));
	}

	return (
		<div className="space-y-3">
			<Choice options={KINDS} value={background.type} onChange={choose} label={(k) => t(`themes.editor.background.${k}`)} />

			{background.type === 'pattern' && (
				<Choice
					options={CHAT_PATTERN_IDS}
					value={background.pattern}
					onChange={(pattern) => onBackground({ type: 'pattern', pattern })}
					label={(p) => t(`settings.chat_bg_${p}`)}
				/>
			)}

			{background.type === 'color' && (
				<HslColorPicker label={t('themes.editor.background.colour')} value={background.color} onChange={(color) => onBackground({ type: 'color', color })} />
			)}

			{background.type === 'gradient' && (
				<div className="space-y-2">
					<HslColorPicker label={t('themes.editor.background.from')} value={background.from} onChange={(from) => onBackground({ ...background, from })} />
					<HslColorPicker label={t('themes.editor.background.to')} value={background.to} onChange={(to) => onBackground({ ...background, to })} />
					<div className="flex items-center gap-3 px-2">
						<span className="w-16 shrink-0 text-xs text-muted-foreground">{t('themes.editor.background.angle')}</span>
						<Slider min={0} max={360} step={5} value={[background.angle]} onValueChange={([angle]) => onBackground({ ...background, angle })} aria-label={t('themes.editor.background.angle')} />
						<span className="w-9 shrink-0 text-end text-xs tabular-nums text-muted-foreground">{background.angle}°</span>
					</div>
				</div>
			)}

			{background.type === 'image' && (
				<div className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<Button type="button" size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
							<ImagePlus />
							{t(image ? 'themes.editor.background.replace' : 'themes.editor.background.upload')}
						</Button>
						{image && (
							<Button type="button" size="sm" variant="ghost" onClick={() => onImage(null)}>
								<Trash2 />
								{t('themes.editor.background.remove')}
							</Button>
						)}
						{image && (
							<span className="text-[11px] text-muted-foreground">
								{image.width}×{image.height} · {(image.bytes.length / 1024).toFixed(0)} KB
							</span>
						)}
					</div>
					<Choice options={FITS} value={background.fit} onChange={(fit) => onBackground({ ...background, fit })} label={(f) => t(`themes.editor.background.fit_${f}`)} />
					<div className="flex items-center gap-3 px-2">
						<span className="w-16 shrink-0 text-xs text-muted-foreground">{t('themes.editor.background.opacity')}</span>
						<Slider min={0} max={100} step={5} value={[Math.round(background.opacity * 100)]} onValueChange={([n]) => onBackground({ ...background, opacity: n / 100 })} aria-label={t('themes.editor.background.opacity')} />
						<span className="w-9 shrink-0 text-end text-xs tabular-nums text-muted-foreground">{Math.round(background.opacity * 100)}%</span>
					</div>
					<div className="flex items-center gap-3 px-2">
						<span className="w-16 shrink-0 text-xs text-muted-foreground">{t('themes.editor.background.blur')}</span>
						<Slider min={0} max={20} step={1} value={[background.blur]} onValueChange={([n]) => onBackground({ ...background, blur: n })} aria-label={t('themes.editor.background.blur')} />
						<span className="w-9 shrink-0 text-end text-xs tabular-nums text-muted-foreground">{background.blur}px</span>
					</div>
					<p className="text-[11px] text-muted-foreground">{t('themes.editor.background.image_hint')}</p>
				</div>
			)}

			<input
				ref={fileInput}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = '';
					if (file) setCropFile(file);
				}}
			/>
			<ImageEditor
				open={cropFile !== null}
				onOpenChange={(open) => {
					if (!open) setCropFile(null);
				}}
				file={cropFile}
				aspectRatio={16 / 9}
				circularCrop={false}
				onSave={(blob, mime) => {
					setCropFile(null);
					void handleCropped(blob, mime);
				}}
			/>
		</div>
	);
}
