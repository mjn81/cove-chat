/** Audio extensions a browser may report with no (or a generic) MIME type, mapped to the type players expect. */
const AUDIO_EXTENSIONS: Record<string, string> = {
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	m4b: 'audio/mp4',
	aac: 'audio/aac',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	opus: 'audio/ogg',
	wav: 'audio/wav',
	flac: 'audio/flac',
	amr: 'audio/amr',
	'3gp': 'audio/3gpp',
	wma: 'audio/x-ms-wma',
	mid: 'audio/midi',
	midi: 'audio/midi',
	weba: 'audio/webm',
};

/** Non-standard audio types some systems report, rewritten so every Cove client uses one name (see Android `AudioMime.kt`). */
const AUDIO_ALIASES: Record<string, string> = {
	'audio/mp3': 'audio/mpeg',
	'audio/x-mpeg': 'audio/mpeg',
	'audio/x-wav': 'audio/wav',
	'audio/wave': 'audio/wav',
	'audio/x-m4a': 'audio/mp4',
	'audio/m4a': 'audio/mp4',
	'audio/x-flac': 'audio/flac',
	'audio/x-aac': 'audio/aac',
};

/**
 * The MIME type to send for a picked file. Systems often report nothing, or `application/octet-stream`, for music,
 * which made songs appear as plain files; the extension fills the gap.
 *
 * @param reported - `File.type` as the browser gave it.
 * @param fileName - The file name, used for the extension fallback.
 * @returns the type to store in the file metadata.
 */
export function resolveMime(reported: string, fileName: string): string {
	const mime = reported.toLowerCase().trim();
	if (AUDIO_ALIASES[mime]) return AUDIO_ALIASES[mime];
	if (mime && mime !== 'application/octet-stream') return mime;
	const dot = fileName.lastIndexOf('.');
	const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
	return AUDIO_EXTENSIONS[ext] ?? 'application/octet-stream';
}
