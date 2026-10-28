/** Public sign-up policy and instance flags from `GET /api/server-info` (mirrors the backend `ServerInfoResponse`). */
export interface PublicServerInfo {
	registration_mode: 'open' | 'invite_only' | 'closed';
	needs_owner: boolean;
	/** True on a public demo instance: data resets and nothing private should be entered. */
	demo?: boolean;
	/** Cloudflare Turnstile public key; present only when sign-up needs a bot-check token. */
	turnstile_site_key?: string;
}
