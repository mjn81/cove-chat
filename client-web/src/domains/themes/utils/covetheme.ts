/**
 * `.covetheme` format v1: parser, validator and writer.
 *
 * A theme file is a ZIP holding `theme.json` plus an optional `assets/` folder of images. It is data only: no CSS,
 * JavaScript, HTML, SVG or fonts are ever read, and anything the schema does not name is dropped. Every function
 * here is pure (no DOM, no network), so the whole security surface is covered by unit tests.
 */
import { strFromU8, strToU8, zipSync } from 'fflate';
import type {
	ChatBackgroundConfig,
	ChatImageFit,
	LocalizedName,
	PartialTokenSet,
	ThemeAsset,
	ThemeChat,
	ThemeDefinition,
	ThemeMode,
} from '../types/themes.types';
import { contrastRatio, parseColorValue } from './color';
import { isChatPatternId } from './chat-backgrounds';
import { sniffImage } from './image-sniff';
import { MIN_CONTRAST_HARD, checkReadability, sanitizeTokens, type ThemeIssue } from './tokens';
import { readZip, type ZipLimits } from './zip-reader';

/** Hard limits for an incoming theme file (plan section 1.3). */
export const COVETHEME_LIMITS = {
	/** The whole archive. */
	maxArchiveBytes: 10 * 1024 * 1024,
	/** Entries, directories included. */
	maxEntries: 20,
	/** `theme.json`. */
	maxJsonBytes: 64 * 1024,
	/** One image. */
	maxImageBytes: 2 * 1024 * 1024,
	/** All images together. */
	maxTotalImageBytes: 8 * 1024 * 1024,
	/** Pixels per side. */
	maxImageSide: 4096,
	/** Expanded/compressed ratio above which an entry is refused (images and tiny JSON are exempt below the floor). */
	maxRatio: 100,
} as const;

/** MIME type used when a theme is shared as a file. */
export const COVETHEME_MIME = 'application/vnd.cove.theme+zip';
/** File extension, with the dot. */
export const COVETHEME_EXTENSION = '.covetheme';

const ZIP_LIMITS: ZipLimits = {
	maxArchiveBytes: COVETHEME_LIMITS.maxArchiveBytes,
	maxEntries: COVETHEME_LIMITS.maxEntries,
	// Generous on purpose: the specific limits below report friendlier errors (`image_too_large`, ...).
	maxEntryBytes: COVETHEME_LIMITS.maxImageBytes * 2,
	maxTotalBytes: COVETHEME_LIMITS.maxArchiveBytes * 2,
	maxRatio: COVETHEME_LIMITS.maxRatio,
	ratioFloorBytes: COVETHEME_LIMITS.maxJsonBytes,
};

/** Outcome of {@link parseCoveTheme}. */
export type ParseResult =
	| { ok: true; theme: ThemeDefinition; assets: Record<string, ThemeAsset>; warnings: ThemeIssue[] }
	| { ok: false; error: ThemeIssue; errors: ThemeIssue[] };

const failWith = (errors: ThemeIssue[]): ParseResult => ({ ok: false, error: errors[0], errors });

const ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ASSET_NAME_RE = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(png|jpe?g|webp)$/;
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const BAD_TEXT_RE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿]/;
const EXT_MIME: Record<string, ThemeAsset['mime']> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
};
const FITS: readonly ChatImageFit[] = ['cover', 'contain', 'tile'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Trimmed, NFC-normalised display text, or `null` if empty, too long or containing control / bidi characters. */
function cleanText(value: unknown, maxLength: number): string | null {
	if (typeof value !== 'string') return null;
	const text = value.normalize('NFC').trim();
	if (text.length === 0 || text.length > maxLength || BAD_TEXT_RE.test(text)) return null;
	return text;
}

function warnUnknownKeys(obj: Record<string, unknown>, known: readonly string[], scope: string, warnings: ThemeIssue[]) {
	for (const key of Object.keys(obj)) {
		if (!known.includes(key)) warnings.push({ code: 'unknown_key', detail: `${scope}${key}`.slice(0, 60) });
	}
}

interface Ctx {
	errors: ThemeIssue[];
	warnings: ThemeIssue[];
	assets: Record<string, ThemeAsset>;
}

function parseName(value: unknown, ctx: Ctx): LocalizedName | null {
	if (!isRecord(value)) {
		ctx.errors.push({ code: 'invalid_name' });
		return null;
	}
	warnUnknownKeys(value, ['en', 'fa', 'ar'], 'name.', ctx.warnings);
	const en = cleanText(value.en, 40);
	if (!en) {
		ctx.errors.push({ code: 'invalid_name', detail: 'en' });
		return null;
	}
	const name: LocalizedName = { en };
	for (const lang of ['fa', 'ar'] as const) {
		if (value[lang] === undefined) continue;
		const text = cleanText(value[lang], 40);
		if (text) name[lang] = text;
		else ctx.warnings.push({ code: 'invalid_name_dropped', detail: lang });
	}
	return name;
}

function parseColorField(value: unknown, field: string, ctx: Ctx): string | null {
	const parsed = parseColorValue(value);
	if (!parsed) {
		ctx.errors.push({ code: 'invalid_color', detail: field });
		return null;
	}
	if (parsed.clamped) ctx.warnings.push({ code: 'token_clamped', detail: field });
	return parsed.value;
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;

function parseBackground(value: unknown, ctx: Ctx): ChatBackgroundConfig | undefined {
	if (!isRecord(value)) {
		ctx.errors.push({ code: 'invalid_chat_background' });
		return undefined;
	}
	const type = value.type;
	switch (type) {
		case 'none':
			warnUnknownKeys(value, ['type'], 'chat.background.', ctx.warnings);
			return { type: 'none' };
		case 'pattern':
			warnUnknownKeys(value, ['type', 'pattern'], 'chat.background.', ctx.warnings);
			if (!isChatPatternId(value.pattern)) {
				ctx.errors.push({ code: 'invalid_chat_background', detail: 'pattern' });
				return undefined;
			}
			return { type: 'pattern', pattern: value.pattern };
		case 'color': {
			warnUnknownKeys(value, ['type', 'color'], 'chat.background.', ctx.warnings);
			const color = parseColorField(value.color, 'chat.background.color', ctx);
			return color ? { type: 'color', color } : undefined;
		}
		case 'gradient': {
			warnUnknownKeys(value, ['type', 'from', 'to', 'angle'], 'chat.background.', ctx.warnings);
			const from = parseColorField(value.from, 'chat.background.from', ctx);
			const to = parseColorField(value.to, 'chat.background.to', ctx);
			if (!from || !to) return undefined;
			return { type: 'gradient', from, to, angle: Math.round(num(value.angle, 180, 0, 360)) };
		}
		case 'image': {
			warnUnknownKeys(value, ['type', 'asset', 'opacity', 'blur', 'fit'], 'chat.background.', ctx.warnings);
			const asset = value.asset;
			if (typeof asset !== 'string' || !Object.hasOwn(ctx.assets, asset)) {
				ctx.errors.push({ code: 'missing_asset', detail: typeof asset === 'string' ? asset.slice(0, 80) : 'asset' });
				return undefined;
			}
			const fit = FITS.includes(value.fit as ChatImageFit) ? (value.fit as ChatImageFit) : 'cover';
			return {
				type: 'image',
				asset,
				opacity: num(value.opacity, 1, 0, 1),
				blur: num(value.blur, 0, 0, 20),
				fit,
			};
		}
		default:
			ctx.errors.push({ code: 'invalid_chat_background', detail: 'type' });
			return undefined;
	}
}

function parseChat(value: unknown, ctx: Ctx): ThemeChat | undefined {
	if (!isRecord(value)) {
		ctx.errors.push({ code: 'invalid_chat' });
		return undefined;
	}
	warnUnknownKeys(value, ['background', 'bubble_tint'], 'chat.', ctx.warnings);
	const chat: ThemeChat = {};
	if (value.background !== undefined) {
		const bg = parseBackground(value.background, ctx);
		if (bg) chat.background = bg;
	}
	if (value.bubble_tint !== undefined) {
		const tint = value.bubble_tint;
		if (isRecord(tint)) {
			warnUnknownKeys(tint, ['color', 'strength'], 'chat.bubble_tint.', ctx.warnings);
			const parsed = parseColorValue(tint.color);
			if (parsed) chat.bubbleTint = { color: parsed.value, strength: num(tint.strength, 0.1, 0, 1) };
			else ctx.warnings.push({ code: 'bubble_tint_dropped' });
		} else {
			ctx.warnings.push({ code: 'bubble_tint_dropped' });
		}
	}
	return Object.keys(chat).length > 0 ? chat : undefined;
}

const TOP_LEVEL_KEYS = ['format', 'version', 'id', 'name', 'author', 'license', 'base', 'tokens', 'light', 'chat', 'preview'];

/**
 * Validates a decoded `theme.json` against the schema.
 *
 * @param json The parsed JSON value (untrusted).
 * @param assets Images from the archive that already passed the image checks, keyed by archive path.
 * @returns The sanitised theme, or the list of errors (with warnings for things that were dropped or clamped).
 */
export function validateThemeJson(
	json: unknown,
	assets: Record<string, ThemeAsset> = {},
): { ok: true; theme: ThemeDefinition; warnings: ThemeIssue[] } | { ok: false; errors: ThemeIssue[]; warnings: ThemeIssue[] } {
	const ctx: Ctx = { errors: [], warnings: [], assets };
	if (!isRecord(json)) return { ok: false, errors: [{ code: 'invalid_json' }], warnings: [] };

	if (json.format !== 'cove-theme') return { ok: false, errors: [{ code: 'not_a_theme' }], warnings: [] };
	if (typeof json.version !== 'number' || !Number.isInteger(json.version) || json.version < 1) {
		return { ok: false, errors: [{ code: 'invalid_version' }], warnings: [] };
	}
	if (json.version > 1) return { ok: false, errors: [{ code: 'unsupported_version', detail: String(json.version) }], warnings: [] };
	warnUnknownKeys(json, TOP_LEVEL_KEYS, '', ctx.warnings);

	const id = typeof json.id === 'string' && json.id.length >= 3 && json.id.length <= 64 && ID_RE.test(json.id) ? json.id : null;
	if (!id) ctx.errors.push({ code: 'invalid_id' });

	const name = parseName(json.name, ctx);

	let author: string | undefined;
	if (json.author !== undefined) {
		author = cleanText(json.author, 60) ?? undefined;
		if (!author) ctx.warnings.push({ code: 'author_dropped' });
	}
	let license: string | undefined;
	if (json.license !== undefined) {
		license = cleanText(json.license, 40) ?? undefined;
		if (!license) ctx.warnings.push({ code: 'license_dropped' });
	}

	const base: ThemeMode | null = json.base === 'dark' || json.base === 'light' ? json.base : null;
	if (!base) ctx.errors.push({ code: 'invalid_base' });

	const main = sanitizeTokens(json.tokens);
	ctx.errors.push(...main.errors);
	ctx.warnings.push(...main.warnings);
	if (main.errors.length === 0) {
		const r = checkReadability(main.tokens);
		ctx.errors.push(...r.errors);
		ctx.warnings.push(...r.warnings);
	}

	let light: PartialTokenSet | undefined;
	if (json.light !== undefined) {
		if (base === 'light') {
			ctx.warnings.push({ code: 'light_ignored' });
		} else {
			const l = sanitizeTokens(json.light);
			ctx.errors.push(...l.errors.map((e) => ({ ...e, detail: `light.${e.detail ?? ''}` })));
			ctx.warnings.push(...l.warnings.map((w) => ({ ...w, detail: `light.${w.detail ?? ''}` })));
			if (l.errors.length === 0) {
				const r = checkReadability(l.tokens);
				ctx.errors.push(...r.errors.map((e) => ({ ...e, detail: `light.${e.detail ?? ''}` })));
				ctx.warnings.push(...r.warnings.map((w) => ({ ...w, detail: `light.${w.detail ?? ''}` })));
				light = l.tokens;
			}
		}
	}

	const chat = json.chat !== undefined ? parseChat(json.chat, ctx) : undefined;

	// Text sits on top of a flat or gradient chat background: it must stay readable in every variant.
	const bg = chat?.background;
	if (bg && (bg.type === 'color' || bg.type === 'gradient')) {
		const surfaces = bg.type === 'color' ? [bg.color] : [bg.from, bg.to];
		const foregrounds = [main.tokens.foreground, light?.foreground].filter((f): f is string => f !== undefined);
		if (surfaces.some((s) => foregrounds.some((f) => contrastRatio(f, s) < MIN_CONTRAST_HARD))) {
			ctx.errors.push({ code: 'low_contrast', detail: 'chat-background' });
		}
	}

	let preview: string | undefined;
	if (json.preview !== undefined) {
		if (typeof json.preview === 'string' && Object.hasOwn(assets, json.preview)) preview = json.preview;
		else ctx.warnings.push({ code: 'missing_preview' });
	}

	if (ctx.errors.length > 0 || !id || !name || !base) return { ok: false, errors: ctx.errors, warnings: ctx.warnings };

	const theme: ThemeDefinition = { id, name, base, tokens: main.tokens };
	if (author) theme.author = author;
	if (license) theme.license = license;
	if (light) theme.light = light;
	if (chat) theme.chat = chat;
	if (preview) theme.preview = preview;
	return { ok: true, theme, warnings: ctx.warnings };
}

/**
 * Parses and fully validates a `.covetheme` file. This is the only entry point for untrusted theme bytes.
 *
 * Order matters: the archive is hardened first, images are checked by magic bytes and header dimensions, and only
 * then is `theme.json` read. Never throws; every failure is a `{ ok: false }` result with a stable error code.
 *
 * Decoding the images (`createImageBitmap`) is a separate, browser-only step (`verifyThemeAssets`).
 *
 * @param bytes The raw file.
 */
export function parseCoveTheme(bytes: Uint8Array): ParseResult {
	try {
		return parseUnsafe(bytes);
	} catch {
		// Defence in depth: a bug in a parser must not become an unhandled crash on an untrusted file.
		return failWith([{ code: 'zip_invalid' }]);
	}
}

function parseUnsafe(bytes: Uint8Array): ParseResult {
	const zip = readZip(bytes, ZIP_LIMITS);
	if (!zip.ok) return failWith([zip.error]);

	const warnings: ThemeIssue[] = [];
	const assets: Record<string, ThemeAsset> = {};
	let imageTotal = 0;

	for (const [name, data] of zip.entries) {
		if (name === 'theme.json') continue;
		if (!name.startsWith('assets/')) {
			warnings.push({ code: 'ignored_entry', detail: name.slice(0, 60) });
			continue;
		}
		const m = ASSET_NAME_RE.exec(name);
		if (!m) return failWith([{ code: 'invalid_asset_name', detail: name }]);
		if (data.length > COVETHEME_LIMITS.maxImageBytes) return failWith([{ code: 'image_too_large', detail: name }]);
		const sniffed = sniffImage(data);
		if (!sniffed) return failWith([{ code: 'invalid_image', detail: name }]);
		if (sniffed.mime !== EXT_MIME[m[1]]) return failWith([{ code: 'image_type_mismatch', detail: name }]);
		if (sniffed.width > COVETHEME_LIMITS.maxImageSide || sniffed.height > COVETHEME_LIMITS.maxImageSide) {
			return failWith([{ code: 'image_dimensions', detail: name }]);
		}
		imageTotal += data.length;
		if (imageTotal > COVETHEME_LIMITS.maxTotalImageBytes) return failWith([{ code: 'assets_too_large' }]);
		assets[name] = { mime: sniffed.mime, bytes: data, width: sniffed.width, height: sniffed.height };
	}

	const jsonBytes = zip.entries.get('theme.json');
	if (!jsonBytes) return failWith([{ code: 'missing_theme_json' }]);
	if (jsonBytes.length > COVETHEME_LIMITS.maxJsonBytes) return failWith([{ code: 'json_too_large' }]);

	let json: unknown;
	try {
		const text = strFromU8(jsonBytes).replace(/^﻿/, '');
		json = JSON.parse(text);
	} catch {
		return failWith([{ code: 'invalid_json' }]);
	}

	const result = validateThemeJson(json, assets);
	if (!result.ok) return failWith(result.errors);

	// Keep only the images the theme actually uses.
	const used = new Set<string>();
	const bg = result.theme.chat?.background;
	if (bg?.type === 'image') used.add(bg.asset);
	if (result.theme.preview) used.add(result.theme.preview);
	const kept: Record<string, ThemeAsset> = {};
	for (const path of Object.keys(assets)) {
		if (used.has(path)) kept[path] = assets[path];
		else warnings.push({ code: 'unused_asset', detail: path });
	}
	return { ok: true, theme: result.theme, assets: kept, warnings: [...warnings, ...result.warnings] };
}

/** Converts a validated theme back into the `theme.json` object (snake_case, as on the wire). */
export function themeToJson(theme: ThemeDefinition): Record<string, unknown> {
	const chat: Record<string, unknown> = {};
	const bg = theme.chat?.background;
	if (bg) chat.background = bg.type === 'pattern' ? { type: 'pattern', pattern: bg.pattern } : { ...bg };
	if (theme.chat?.bubbleTint) chat.bubble_tint = { ...theme.chat.bubbleTint };
	const json: Record<string, unknown> = {
		format: 'cove-theme',
		version: 1,
		id: theme.id,
		name: { ...theme.name },
		...(theme.author ? { author: theme.author } : {}),
		...(theme.license ? { license: theme.license } : {}),
		base: theme.base,
		tokens: { ...theme.tokens },
		...(theme.light ? { light: { ...theme.light } } : {}),
		...(Object.keys(chat).length > 0 ? { chat } : {}),
		...(theme.preview ? { preview: theme.preview } : {}),
	};
	return json;
}

/**
 * Writes a `.covetheme` archive.
 *
 * @param theme A validated theme.
 * @param assets The images the theme references, keyed by archive path.
 * @returns The ZIP bytes (images are stored, they are already compressed).
 */
export function buildCoveTheme(theme: ThemeDefinition, assets: Record<string, ThemeAsset> = {}): Uint8Array {
	const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
		'theme.json': strToU8(JSON.stringify(themeToJson(theme), null, 2)),
	};
	for (const [path, asset] of Object.entries(assets)) files[path] = [asset.bytes, { level: 0 }];
	return zipSync(files);
}
