/**
 * Client side of the Cove API standard (docs/api-standard.md): the API version this build speaks, the
 * X-Cove-Client header, the stable error-code registry and the pure helpers the version gate relies on.
 */

/** Integer contract version this build was written against. Bump only together with the backend (`apistd.APIVersion`). */
export const API_VERSION = 2;

/** Request header every client sends; the server uses it for the minimum-client check. */
export const CLIENT_HEADER = 'X-Cove-Client';

/** Window event fired when the server answers 426 / `client_outdated`; `detail` is {@link ClientOutdatedDetail}. */
export const CLIENT_OUTDATED_EVENT = 'api:client_outdated';

/** Stable machine codes from the error registry. Clients branch on these, never on the human message. */
export const API_ERROR_CODES = [
	'client_outdated',
	'server_outdated',
	'feature_unsupported',
	'unauthorized',
	'forbidden',
	'not_found',
	'validation_failed',
	'rate_limited',
	'conflict',
	'payload_too_large',
	'method_not_allowed',
	'service_unavailable',
	'internal',
] as const;

/** One of the registered error codes. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Optional server features advertised in `capabilities`. Unknown names from newer servers are tolerated. */
export type Capability = 'invite_messages' | 'whisper' | 'webrtc_sfu' | 'raw_udp_voice';

/** Payload of {@link CLIENT_OUTDATED_EVENT}. */
export interface ClientOutdatedDetail {
	/** The oldest client version the server accepts, when it said so. */
	minClientVersion?: string;
}

/**
 * Builds the `X-Cove-Client` header value, e.g. `web/0.10.0 (api 2)`.
 *
 * @param platform - `web`, `desktop` or `android`.
 * @param version - Semver of this build.
 */
export function clientHeaderValue(platform: 'web' | 'desktop' | 'android', version: string): string {
	return `${platform}/${version} (api ${API_VERSION})`;
}

/**
 * Narrows an unknown value to a registered error code.
 *
 * @param value - Anything, typically `error.data.code`.
 * @returns true when `value` is a code from the registry; unknown codes from a newer server return false.
 */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
	return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Reads `code` and `details.min_client_version` out of an error response body without trusting its shape.
 *
 * @param data - The parsed JSON error body (or anything).
 */
export function parseErrorEnvelope(data: unknown): { code?: ApiErrorCode; minClientVersion?: string } {
	if (typeof data !== 'object' || data === null) return {};
	const body = data as { code?: unknown; details?: unknown };
	const details = typeof body.details === 'object' && body.details !== null ? (body.details as Record<string, unknown>) : {};
	const min = details.min_client_version;
	return {
		code: isApiErrorCode(body.code) ? body.code : undefined,
		minClientVersion: typeof min === 'string' && min !== '' ? min : undefined,
	};
}

/** Parses MAJOR[.MINOR[.PATCH]] ignoring a leading `v` and any `-pre`/`+build` suffix; null when unparsable. */
function parseSemver(v: string): [number, number, number] | null {
	const core = v.trim().replace(/^v/i, '').split(/[-+]/)[0];
	if (!/^\d+(\.\d+){0,2}$/.test(core)) return null;
	const [major, minor = 0, patch = 0] = core.split('.').map(Number);
	return [major, minor, patch];
}

/**
 * Compares two semvers.
 *
 * @returns -1, 0 or 1, or null when either side is not a version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) return null;
	for (let i = 0; i < 3; i++) {
		if (pa[i] < pb[i]) return -1;
		if (pa[i] > pb[i]) return 1;
	}
	return 0;
}

/**
 * Whether this build is older than the server's advertised minimum. An empty or unparsable minimum never
 * counts as outdated, so a server that sets none (or an old one that sends nothing) never triggers the banner.
 *
 * @param current - This build's version.
 * @param minClientVersion - `min_client_version` from `/api/version`.
 */
export function isBelowMinimum(current: string, minClientVersion: string | undefined): boolean {
	if (!minClientVersion) return false;
	return compareVersions(current, minClientVersion) === -1;
}

/**
 * Capability check that tolerates old servers: a missing `capabilities` list means no optional features.
 *
 * @param capabilities - The list from `/api/version`, if any.
 * @param name - The capability to look for.
 */
export function hasCapability(capabilities: readonly string[] | undefined, name: Capability): boolean {
	return !!capabilities && capabilities.includes(name);
}
