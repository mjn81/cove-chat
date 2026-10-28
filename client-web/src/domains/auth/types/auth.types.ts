/** Public sign-up policy and instance flags from `GET /api/server-info` (mirrors the backend `ServerInfoResponse`). */
export interface PublicServerInfo {
	registration_mode: 'open' | 'invite_only' | 'closed';
	needs_owner: boolean;
	/** True on a public demo instance: data resets and nothing private should be entered. */
	demo?: boolean;
	/** True when sign-up needs a solved proof-of-work challenge (an admin enabled it); false for the first account. */
	captcha_required?: boolean;
}
