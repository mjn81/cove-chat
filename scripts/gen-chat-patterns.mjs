// Generates the Lucide-based chat background patterns for both clients.
//
//   node scripts/gen-chat-patterns.mjs        (or: make patterns)
//
// Each theme scatters themed icons (rotated, slightly jittered, on a staggered grid) plus small dots, crosses and
// squiggles over the same 1440x2960 tile the Telegram-style sets use. Output is deterministic (seeded), so
// regenerating produces identical files.
//
//   client-web/src/assets/patterns/<id>.svg                    masked by ChatBackgroundPattern.tsx
//   client-android/app/src/main/assets/patterns/<id>.txt       "a b c d e f|pathData" lines, see ChatBackground.kt
//
// Icons come from lucide-react (ISC licence); the notice is kept next to the outputs (see NOTICE.md there).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'client-web/node_modules/lucide-react/dist/esm/icons');
const webOut = join(root, 'client-web/src/assets/patterns');
const androidOut = join(root, 'client-android/app/src/main/assets/patterns');

const W = 1440;
const H = 2960;
const STROKE = 4; // viewBox units, a touch heavier than the Telegram sets so thin Lucide strokes hold up at small sizes

const THEMES = {
	travel: [
		'plane', 'map', 'map-pin', 'compass', 'luggage', 'tent', 'mountain', 'train-front', 'car', 'bus', 'ship',
		'sailboat', 'camera', 'globe', 'backpack', 'ticket', 'umbrella', 'tree-palm', 'sun', 'anchor', 'bike',
		'binoculars', 'flag', 'landmark', 'hotel', 'caravan', 'tram-front', 'fuel',
	],
	nature: [
		'leaf', 'trees', 'tree-pine', 'flower', 'flower-2', 'sprout', 'cloud', 'sun', 'moon', 'mountain-snow', 'bird',
		'bug', 'rabbit', 'squirrel', 'fish', 'shell', 'clover', 'wheat', 'droplet', 'wind', 'waves', 'feather',
		'turtle', 'snail', 'mushroom', 'cat', 'dog', 'rat',
	],
	food: [
		'pizza', 'coffee', 'cake-slice', 'cookie', 'apple', 'banana', 'cherry', 'carrot', 'citrus', 'croissant',
		'egg-fried', 'hamburger', 'ice-cream-cone', 'milk', 'salad', 'sandwich', 'soup', 'utensils', 'wine', 'beer',
		'grape', 'drumstick', 'popcorn', 'candy', 'cup-soda', 'donut', 'beef', 'cooking-pot', 'chef-hat',
	],
	music: [
		'music', 'music-2', 'music-3', 'music-4', 'headphones', 'guitar', 'piano', 'mic', 'mic-vocal', 'radio',
		'speaker', 'drum', 'disc', 'disc-3', 'volume-2', 'audio-lines', 'audio-waveform', 'ear', 'podcast',
		'metronome', 'boombox', 'play', 'repeat', 'shuffle', 'list-music', 'heart',
	],
	tech: [
		'code', 'terminal', 'cpu', 'wifi', 'bluetooth', 'battery-charging', 'smartphone', 'laptop', 'monitor',
		'keyboard', 'mouse', 'server', 'database', 'cloud', 'git-branch', 'bug', 'braces', 'hard-drive', 'usb',
		'shield', 'lock', 'key', 'bot', 'rocket', 'satellite', 'qr-code', 'binary', 'circuit-board', 'plug',
		'antenna', 'gamepad-2', 'webcam',
	],
	weather: [
		'sun', 'moon', 'cloud', 'cloud-rain', 'cloud-snow', 'cloud-lightning', 'cloud-sun', 'cloud-moon',
		'cloud-fog', 'snowflake', 'wind', 'rainbow', 'thermometer', 'umbrella', 'droplets', 'tornado', 'sunrise',
		'sunset', 'star', 'haze', 'waves', 'zap', 'sparkles', 'flame',
	],
};

// ---- seeded randomness ----------------------------------------------------------------------------------------

function hash(text) {
	let h = 2166136261;
	for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
	return h >>> 0;
}

function rng(seed) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---- icon geometry -> path data ---------------------------------------------------------------------------------

const num = (n) => String(Math.round(n * 100) / 100);

function elementToPath(tag, a) {
	switch (tag) {
		case 'path':
			return a.d;
		case 'circle': {
			const r = +a.r;
			return `M${+a.cx - r} ${a.cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
		}
		case 'ellipse': {
			const rx = +a.rx;
			const ry = +a.ry;
			return `M${+a.cx - rx} ${a.cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
		}
		case 'line':
			return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
		case 'polyline':
		case 'polygon': {
			const pts = a.points.trim().split(/[\s,]+/).map(Number);
			let d = `M${pts[0]} ${pts[1]}`;
			for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
			return tag === 'polygon' ? `${d}Z` : d;
		}
		case 'rect': {
			const x = +a.x || 0;
			const y = +a.y || 0;
			const w = +a.width;
			const h = +a.height;
			const r = Math.min(+a.rx || +a.ry || 0, w / 2, h / 2);
			if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
			return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
		}
		default:
			return null;
	}
}

const iconCache = new Map();

/** The path data pieces of a Lucide icon (24x24 grid), or null when this Lucide version has no such icon. */
function loadIcon(name) {
	if (iconCache.has(name)) return iconCache.get(name);
	let paths = null;
	try {
		const text = readFileSync(join(iconsDir, `${name}.js`), 'utf8');
		const start = text.indexOf('const __iconNode = ') + 'const __iconNode = '.length;
		const end = text.indexOf(';\nconst ', start);
		const node = new Function(`return ${text.slice(start, end)}`)();
		paths = node.map(([tag, attrs]) => elementToPath(tag, attrs)).filter(Boolean);
	} catch {
		paths = null;
	}
	iconCache.set(name, paths);
	return paths;
}

// ---- layout ---------------------------------------------------------------------------------------------------

/** One placed shape: a matrix in viewBox units and the path data it applies to, plus its scale (for SVG stroke). */
function place(paths, cx, cy, scale, angle, centre = 12) {
	const cos = Math.cos(angle) * scale;
	const sin = Math.sin(angle) * scale;
	const e = cx - (cos * centre - sin * centre);
	const f = cy - (sin * centre + cos * centre);
	return { m: [cos, sin, -sin, cos, e, f].map((n) => Math.round(n * 1000) / 1000), paths, scale };
}

/** Small ornaments for the gaps between icons: ring, dot, plus, short wave, diamond. */
function filler(random) {
	const kind = Math.floor(random() * 5);
	switch (kind) {
		case 0:
			return ['M5 12a7 7 0 1 0 14 0a7 7 0 1 0-14 0']; // ring
		case 1:
			return ['M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0']; // dot
		case 2:
			return ['M12 5v14M5 12h14']; // plus
		case 3:
			return ['M3 13c3-6 6-6 9 0s6 6 9 0']; // wave
		default:
			return ['M12 4l8 8-8 8-8-8z']; // diamond
	}
}

/** Shortest distance between two points on the tile when it wraps around at the edges. */
function wrapDist(ax, ay, bx, by) {
	let dx = Math.abs(ax - bx);
	let dy = Math.abs(ay - by);
	if (dx > W / 2) dx = W - dx;
	if (dy > H / 2) dy = H - dy;
	return Math.hypot(dx, dy);
}

/**
 * Packs the tile the way the Telegram sets look: shapes of very different sizes, turned any way, nested into each
 * other's gaps with no rows or columns. Big icons go down first, then each size class fills the largest holes left
 * (best-candidate sampling on a wrapping tile), until not even a tiny ornament fits. Shapes that cross an edge are
 * repeated on the opposite side, so the tile repeats without a seam.
 */
function buildTheme(id, names) {
	const random = rng(hash(id));
	const icons = names.map((n) => ({ name: n, paths: loadIcon(n) })).filter((i) => i.paths);
	if (icons.length < 12) throw new Error(`${id}: only ${icons.length} icons found`);

	// A bag of the theme's icons, reshuffled each time it runs out, so the same icon rarely repeats close by.
	let bag = [];
	const nextIcon = () => {
		if (bag.length === 0) {
			bag = [...icons];
			for (let i = bag.length - 1; i > 0; i--) {
				const j = Math.floor(random() * (i + 1));
				[bag[i], bag[j]] = [bag[j], bag[i]];
			}
		}
		return bag.pop();
	};

	const placed = []; // { x, y, r } circles that stand in for each shape when measuring clearance
	const shapes = [];

	/** Best of `tries` random spots: the one with the most free room around it for a circle of radius r. */
	const findSpot = (r, tries) => {
		let best = null;
		for (let t = 0; t < tries; t++) {
			const x = random() * W;
			const y = random() * H;
			let clearance = Infinity;
			for (const o of placed) {
				const c = wrapDist(x, y, o.x, o.y) - o.r - r;
				if (c < clearance) clearance = c;
				if (best && clearance <= best.clearance) break; // cannot beat the best so far
			}
			if (!best || clearance > best.clearance) best = { x, y, clearance };
		}
		return best;
	};

	/** Adds a shape (plus wrapped copies near the edges) when it fits with at least `gap` units around it. */
	const add = (paths, scale, centre, radius, gap, tries) => {
		const spot = findSpot(radius, tries);
		if (!spot || spot.clearance < gap) return false;
		const angle = random() * Math.PI * 2; // any rotation, like hand-scattered stickers
		placed.push({ x: spot.x, y: spot.y, r: radius });
		for (const ox of [-W, 0, W]) {
			for (const oy of [-H, 0, H]) {
				const x = spot.x + ox;
				const y = spot.y + oy;
				if (x < -radius || x > W + radius || y < -radius || y > H + radius) continue;
				shapes.push(place(paths, x, y, scale, angle, centre));
			}
		}
		return true;
	};

	// (scale range, how many to try, minimum gap) per size class; the glyph fills about 80% of its 24-unit box.
	const classes = [
		{ min: 5.8, max: 7.2, count: 40, gap: 26, tries: 500 },
		{ min: 4.4, max: 5.4, count: 70, gap: 22, tries: 400 },
		{ min: 3.4, max: 4.2, count: 90, gap: 18, tries: 300 },
	];
	for (const cls of classes) {
		for (let i = 0; i < cls.count; i++) {
			const scale = cls.min + random() * (cls.max - cls.min);
			if (!add(nextIcon().paths, scale, 12, 9.6 * scale, cls.gap, cls.tries)) break;
		}
	}
	// A limited sprinkle of small icons and ornaments in the larger holes; the rest stays open so the pattern breathes.
	for (let i = 0; i < 160; i++) {
		const small = random() < 0.4;
		const scale = small ? 2.6 + random() * 0.6 : 1.5 + random() * 1;
		const paths = small ? nextIcon().paths : filler(random);
		if (!add(paths, scale, 12, 9.6 * scale, 16, 150)) break;
	}
	return shapes;
}

// ---- output ---------------------------------------------------------------------------------------------------

function svgFor(shapes) {
	const body = shapes
		.map((s) => {
			const sw = num(STROKE / s.scale);
			const d = s.paths.join('');
			return `<path transform="matrix(${s.m.map(num).join(' ')})" stroke-width="${sw}" d="${d}"/>`;
		})
		.join('\n');
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">\n${body}\n</g></svg>\n`;
}

function txtFor(shapes) {
	const lines = [`#viewbox ${W} ${H}`];
	for (const s of shapes) lines.push(`${s.m.map(num).join(' ')}|${s.paths.join('')}`);
	return `${lines.join('\n')}\n`;
}

for (const [id, names] of Object.entries(THEMES)) {
	const shapes = buildTheme(id, names);
	writeFileSync(join(webOut, `${id}.svg`), svgFor(shapes));
	writeFileSync(join(androidOut, `${id}.txt`), txtFor(shapes));
	console.log(`${id}: ${shapes.length} shapes`);
}
