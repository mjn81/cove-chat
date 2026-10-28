/** Public demo instance; offered as a one-click choice on the server-selection step. */
export const DEMO_SERVER_URL = 'https://demo.covechat.dev';

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LAN_SUFFIXES = ['.local', '.lan', '.internal', '.home.arpa'];

/**
 * True for hosts that are almost never fronted by a public TLS certificate: loopback, IP literals and
 * LAN-only names. Those default to plain http, everything else to https.
 */
function looksLocal(url: URL): boolean {
	const host = url.hostname;
	return (
		host === 'localhost' ||
		host.startsWith('[') ||
		IPV4.test(host) ||
		!host.includes('.') ||
		LAN_SUFFIXES.some((s) => host.endsWith(s)) ||
		url.port !== ''
	);
}

/**
 * Turns what a user typed into the ordered list of server origins to probe.
 *
 * A bare public domain ("demo.covechat.dev") tries https first: a server behind a TLS proxy redirects
 * http to https, but a WebSocket upgrade does not survive that redirect, so saving the http form would
 * break chat even though `/api/version` answered. Local and LAN addresses try http first. An explicit
 * scheme is respected and is the only candidate. Paths, queries and fragments are dropped.
 *
 * @param raw the address as typed by the user.
 * @returns origins to try in order; empty when the input is blank or not a valid host.
 */
export function serverUrlCandidates(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];

	const scheme = SCHEME.exec(trimmed)?.[1].toLowerCase();
	let parsed: URL;
	try {
		parsed = new URL(scheme ? trimmed : `https://${trimmed}`);
	} catch {
		return [];
	}
	if (!parsed.hostname) return [];

	if (scheme === 'http' || scheme === 'https') return [`${scheme}://${parsed.host}`];
	if (scheme) return [];

	const https = `https://${parsed.host}`;
	const http = `http://${parsed.host}`;
	return looksLocal(parsed) ? [http, https] : [https, http];
}

/**
 * Probes each candidate origin for `GET /api/version` and returns the first that answers like a Cove
 * server (a JSON body with a `version`). Network errors, TLS failures and non-2xx answers move on to
 * the next candidate.
 *
 * @param raw the address as typed by the user.
 * @param fetcher injectable for tests; defaults to the global `fetch`.
 * @returns the working origin, or null when none of the candidates is a reachable Cove server.
 */
export async function findReachableServer(raw: string, fetcher: typeof fetch = fetch): Promise<string | null> {
	for (const origin of serverUrlCandidates(raw)) {
		try {
			const res = await fetcher(`${origin}/api/version`, { signal: AbortSignal.timeout(5000) });
			if (!res.ok) continue;
			const data = (await res.json()) as { version?: unknown };
			if (data.version) return origin;
		} catch {
			// Try the next candidate; the caller reports one error if none works.
		}
	}
	return null;
}
