import { describe, expect, it } from 'vitest';
import { DEMO_SERVER_URL, findReachableServer, serverUrlCandidates } from './server-url';

describe('serverUrlCandidates', () => {
	it('tries https first for a bare public domain, then http', () => {
		expect(serverUrlCandidates('demo.covechat.dev')).toEqual([
			'https://demo.covechat.dev',
			'http://demo.covechat.dev',
		]);
	});

	it('keeps an explicit scheme as the only candidate', () => {
		expect(serverUrlCandidates('https://chat.example.com')).toEqual(['https://chat.example.com']);
		expect(serverUrlCandidates('http://chat.example.com')).toEqual(['http://chat.example.com']);
	});

	it('tries http first for localhost, IP addresses, LAN names and explicit ports', () => {
		expect(serverUrlCandidates('localhost:4000')).toEqual(['http://localhost:4000', 'https://localhost:4000']);
		expect(serverUrlCandidates('192.168.1.20:4000')[0]).toBe('http://192.168.1.20:4000');
		expect(serverUrlCandidates('10.0.0.5')[0]).toBe('http://10.0.0.5');
		expect(serverUrlCandidates('nas.local')[0]).toBe('http://nas.local');
		expect(serverUrlCandidates('chat.example.com:8443')[0]).toBe('http://chat.example.com:8443');
	});

	it('drops paths, queries, trailing slashes and whitespace', () => {
		expect(serverUrlCandidates('  https://chat.example.com/app/?x=1#y  ')).toEqual(['https://chat.example.com']);
		expect(serverUrlCandidates('chat.example.com/')[0]).toBe('https://chat.example.com');
	});

	it('is case-insensitive on the scheme and keeps the host as typed', () => {
		expect(serverUrlCandidates('HTTPS://Chat.Example.com')).toEqual(['https://chat.example.com']);
	});

	it('returns nothing for empty or unparsable input', () => {
		expect(serverUrlCandidates('')).toEqual([]);
		expect(serverUrlCandidates('   ')).toEqual([]);
		expect(serverUrlCandidates('http://')).toEqual([]);
	});

	it('exposes the public demo address', () => {
		expect(DEMO_SERVER_URL).toBe('https://demo.covechat.dev');
	});
});

describe('findReachableServer', () => {
	const ok = (version: unknown) =>
		({ ok: true, json: async () => ({ version }) }) as unknown as Response;

	it('returns the first candidate that answers /api/version', async () => {
		const seen: string[] = [];
		const fetcher = (async (url: string) => {
			seen.push(url);
			if (url.startsWith('https://')) throw new Error('tls failure');
			return ok('0.9.1');
		}) as unknown as typeof fetch;
		await expect(findReachableServer('chat.example.com', fetcher)).resolves.toBe('http://chat.example.com');
		expect(seen).toEqual(['https://chat.example.com/api/version', 'http://chat.example.com/api/version']);
	});

	it('rejects a host that answers without a version', async () => {
		const fetcher = (async () => ok(undefined)) as unknown as typeof fetch;
		await expect(findReachableServer('https://x.example.com', fetcher)).resolves.toBeNull();
	});

	it('returns null when nothing answers or the input is empty', async () => {
		const down = (async () => {
			throw new Error('down');
		}) as unknown as typeof fetch;
		await expect(findReachableServer('chat.example.com', down)).resolves.toBeNull();
		await expect(findReachableServer('', down)).resolves.toBeNull();
	});
});
