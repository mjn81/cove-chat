// client.ts — Fully improved API client

import { logger } from '@/utils/logger';
import i18n from '@/i18n';
import { localizeApiErrorMessage } from '@/lib/api-error-message';
import { isWails } from '@/utils/wails';
import { getDesktopToken } from '@/lib/desktop-session';
import { AppVersion } from '../wailsjs/go/main/App';
import axios, { AxiosError } from 'axios';
import type { PublicServerInfo } from '@/domains/auth/types/auth.types';
import type { AltchaChallenge } from '@/lib/altcha';
import { fetchAllPages, MAX_PAGE_LIMIT, type Page } from '@/lib/paging';
import {
	CLIENT_HEADER,
	CLIENT_OUTDATED_EVENT,
	clientHeaderValue,
	parseErrorEnvelope,
	type ApiErrorCode,
	type ClientOutdatedDetail,
} from '@/lib/api-standard';

// ─────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────
const getBaseUrl = () => {
	const envUrl = import.meta.env.VITE_API_URL;
	
	// If an environment URL is provided and it's not localhost, use it
	if (envUrl && !envUrl.includes('localhost')) {
		return envUrl.replace(/\/$/, '');
	}

	// In production builds, we don't want to fallback to localhost:4000
	// unless specifically requested via environment variables.
	if (import.meta.env.PROD) {
		return envUrl ? envUrl.replace(/\/$/, '') : '';
	}

	if (typeof window !== 'undefined') {
		const host = window.location.hostname;
		if (host === '[::1]' || host === '127.0.0.1' || host === 'localhost') {
			let port = '4000';
			if (envUrl) {
				try {
					port = new URL(envUrl).port || '4000';
				} catch {
					// fallback to 4000
				}
			}
			// Match the page's own hostname. The session cookie is
			// SameSite=Lax, and browsers treat 'localhost' and '127.0.0.1'
			// as different sites for that purpose — pointing API calls at a
			// different loopback alias than the page itself is served from
			// makes every post-login request look cross-site, so the cookie
			// gets silently withheld and the user is bounced back to login.
			const apiHost = host === '[::1]' ? '127.0.0.1' : host;
			return `http://${apiHost}:${port}`;
		}
	}
	return (envUrl ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
};

export let BASE_URL = getBaseUrl();

export const setApiBaseUrl = (url: string) => {
	BASE_URL = url.replace(/\/$/, '');
	apiClient.defaults.baseURL = BASE_URL;
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new Event('api:url_changed'));
	}
};

// ─────────────────────────────────────────────
// Custom Error Types
// ─────────────────────────────────────────────
export class APIError extends Error {
	status: number;
	data: unknown;
	/** Stable machine code from the error envelope (docs/api-standard.md); undefined for old servers or unknown codes. */
	code?: ApiErrorCode;

	constructor(status: number, message: string, data?: unknown) {
		super(message);
		this.status = status;
		this.data = data;
		this.code = parseErrorEnvelope(data).code;
	}
}

export class AuthError extends APIError {
	constructor(message = 'Authentication error', data?: unknown) {
		super(401, message, data);
	}
}

export class NetworkError extends Error {
	constructor(message = 'Network error') {
		super(message);
	}
}

// ─────────────────────────────────────────────
// Axios Instance
// ─────────────────────────────────────────────
// Reads a cookie value by name (used for the CSRF double-submit header —
// that cookie is deliberately not httpOnly so JS can read it back).
function getCookie(name: string): string | null {
	if (typeof document === 'undefined') return null;
	const match = document.cookie.match(
		new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'),
	);
	return match ? decodeURIComponent(match[1]) : null;
}

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);

export const apiClient = axios.create({
	baseURL: BASE_URL,
	// The web client authenticates via an httpOnly session cookie; the
	// desktop (Wails) client authenticates via a Bearer token below, since
	// its webview doesn't reliably persist httpOnly cookies.
	withCredentials: true,
	timeout: 3600000, // 1 hour for long uploads/downloads
});

apiClient.interceptors.request.use((config) => {
	// Identify this build on every request so the server can warn or refuse outdated clients (api-standard.md).
	config.headers.set(CLIENT_HEADER, clientHeaderValue(isWails() ? 'desktop' : 'web', __APP_VERSION__));
	if (isWails()) {
		const token = getDesktopToken();
		if (token) {
			config.headers.set('Authorization', `Bearer ${token}`);
		}
	} else {
		// CSRF double-submit: echo the readable CSRF cookie back as a header
		// on state-changing requests. The session cookie itself is httpOnly
		// and travels automatically.
		const method = (config.method || 'get').toLowerCase();
		if (MUTATING_METHODS.has(method)) {
			const csrf = getCookie('cove_csrf');
			if (csrf) {
				config.headers.set('X-CSRF-Token', csrf);
			}
		}
	}
	return config;
});

apiClient.interceptors.response.use(
	(res) => res.data, // Strip AxiosResponse wrapper
	(error: AxiosError) => {
		if (error.code === 'ECONNABORTED' || !error.response) {
			logger.error('Network error', { url: error.config?.url, error });
			throw new NetworkError(error.message);
		}

		const url = error.config?.url || '';
		const status = error.response.status;
		const data = error.response.data as any;
		// Server messages for user-facing handlers are i18n keys; show them in the user's language everywhere.
		const message = localizeApiErrorMessage(data?.error || error.message || `HTTP ${status}`, (key, opts) =>
			i18n.t(key, opts),
		);

		// 426 / client_outdated: the server refuses this build. Tell the version gate instead of letting every
		// caller surface a confusing generic failure.
		const envelope = parseErrorEnvelope(data);
		if ((status === 426 || envelope.code === 'client_outdated') && typeof window !== 'undefined') {
			const detail: ClientOutdatedDetail = { minClientVersion: envelope.minClientVersion };
			window.dispatchEvent(new CustomEvent(CLIENT_OUTDATED_EVENT, { detail }));
		}

		if (status === 401) {
			logger.warn('Unauthorized API error', { url, data });
			if (typeof window !== 'undefined' && !url.includes('/api/logout')) {
				window.dispatchEvent(new Event('auth:unauthorized'));
			}
			throw new AuthError(message, data);
		}

		logger.error('API error', { status, url, data });
		throw new APIError(status, message, data);
	},
);

import type {
	AuthUser,
	Channel,
	ExploreChannel,
	InvitePreview,
	Message,
	Presence,
	UploadedFile,
	User,
	RelationshipResponse,
	RelationshipAction,
	AddMembersResponse,
} from '@/types/api';

// ─────────────────────────────────────────────
// Typed request helper
// ─────────────────────────────────────────────
// The response interceptor above rewrites every response to `res.data` at
// runtime, but axios's own types don't know that — every apiClient call
// statically returns Promise<AxiosResponse<T>> even though it actually
// resolves to T directly. Every wrapper below used to carry its own
// `as unknown as Promise<T>` to paper over this mismatch (~20 near-identical
// casts). This is the one place that bridges the gap now — callers below
// get real Promise<T> typing without each needing its own unsafe cast.
export function request<T>(axiosCall: Promise<unknown>): Promise<T> {
	return axiosCall as unknown as Promise<T>;
}

// ─────────────────────────────────────────────
// Auth API
// ─────────────────────────────────────────────
export async function apiRegister(username: string, password: string, inviteCode?: string, captcha?: string) {
	return request<{ id: string; username: string }>(
		apiClient.post('/api/register', {
			username,
			password,
			...(inviteCode ? { invite_code: inviteCode } : {}),
			...(captcha ? { captcha } : {}),
		}),
	);
}

/** Public sign-up policy, so the register page can adapt before the user types. */
/** Device and app labels the desktop shell sends at login, e.g. "Cove Desktop on Windows" / "Cove Desktop 0.9.0". */
async function desktopDeviceHeaders(): Promise<Record<string, string>> {
	const ua = navigator.userAgent;
	const os = /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : 'Linux';
	let version = '';
	try {
		version = await AppVersion();
	} catch {
		/* binding unavailable: report the app without a version */
	}
	return {
		'X-Cove-Device': `Cove Desktop on ${os}`,
		'X-Cove-App': version ? `Cove Desktop ${version}` : 'Cove Desktop',
	};
}

export async function apiServerInfo() {
	return request<PublicServerInfo>(apiClient.get('/api/server-info'));
}

/** Fetches a sign-up proof-of-work challenge (ALTCHA). 404 when the server has the check turned off. */
export async function apiCaptchaChallenge() {
	return request<AltchaChallenge>(apiClient.get('/api/captcha/challenge'));
}

export async function apiLogin(username: string, password: string) {
	// The server shows these in the user's Devices list; browsers are identified from their User-Agent instead.
	const headers = isWails() ? await desktopDeviceHeaders() : undefined;
	return request<AuthUser>(apiClient.post('/api/login', { username, password }, { headers }));
}

export async function apiLogout() {
	return apiClient.post('/api/logout');
}

export async function apiMe() {
	// Uses a short timeout instead of the client's 1-hour default (sized for
	// large uploads) — this call gates the initial loading screen, so a
	// server that's slow/unreachable at startup must fail fast into the
	// "stay logged in locally, let WS state show connection status" path in
	// auth.slice.ts's initAuth(), rather than leaving the screen stuck.
	return request<AuthUser>(apiClient.get('/api/me', { timeout: 10_000 }));
}

export async function apiGetUser(userId: string) {
	return request<User>(apiClient.get(`/api/users/${userId}`));
}

export async function apiUpdateProfile(data: {
	avatar_id?: string;
	avatar_ids?: string[];
	banner_color?: string;
	username?: string;
	custom_msg?: string;
	status_preference?: string;
	password?: string;
	old_password?: string;
	allow_channel_adds?: string;
	dm_permission?: string;
	friend_request_permission?: string;
}) {
	return request<AuthUser>(apiClient.patch('/api/users/me', data));
}

/**
 * Deletes the signed-in account. The server asks for the current password (step-up) so a stolen session cannot erase it.
 *
 * @param password - The account's current password.
 * @throws APIError 403 when the password is wrong, 429 after repeated failures.
 */
export async function apiDeleteAccount(password: string) {
	return apiClient.delete('/api/users/me', { data: { password } });
}

// ─────────────────────────────────────────────
// Relationships (Friends & Blocking)
// ─────────────────────────────────────────────
/**
 * Fetches one page of a paged list endpoint (docs/api-standard.md section 9).
 *
 * @param path - Endpoint path, e.g. `/api/relationships`.
 * @param cursor - The previous page's `next_cursor`; omit for the first page.
 * @param query - Extra query parameters (undefined values are dropped).
 * @param limit - Page size, 1..100.
 */
export function apiGetPage<T>(
	path: string,
	cursor?: string,
	query: Record<string, string | undefined> = {},
	limit = MAX_PAGE_LIMIT,
): Promise<Page<T>> {
	const params: Record<string, string> = { limit: String(limit) };
	for (const [k, v] of Object.entries(query)) if (v !== undefined) params[k] = v;
	if (cursor) params.cursor = cursor;
	return request<Page<T>>(apiClient.get(path, { params }));
}

export async function apiGetMyRelationships() {
	return fetchAllPages((c) => apiGetPage<RelationshipResponse>('/api/relationships', c));
}

export async function apiGetIncomingRequests() {
	return fetchAllPages((c) => apiGetPage<RelationshipResponse>('/api/relationships/incoming', c));
}

export async function apiGetRelationship(userId: string) {
	return request<RelationshipResponse>(apiClient.get(`/api/users/${userId}/relationship`));
}

export async function apiRelationshipAction(userId: string, action: RelationshipAction) {
	return request<RelationshipResponse>(apiClient.put(`/api/users/${userId}/relationship`, { action }));
}

// ─────────────────────────────────────────────
// Channels
// ─────────────────────────────────────────────
export async function apiListChannels() {
	return fetchAllPages((c) => apiGetPage<Channel>('/api/channels', c));
}

/** Searches public channels; a search palette never needs more than a few pages, so the walk is bounded. */
export async function apiExploreChannels(query: string) {
	return fetchAllPages((c) => apiGetPage<ExploreChannel>('/api/channels/explore', c, { q: query }), 5);
}

export async function apiCreateChannel(
	name: string,
	memberIds: string[],
	isPrivate: boolean,
	description?: string,
	avatarId?: string,
) {
	return request<Channel>(
		apiClient.post('/api/channels', {
			name,
			members: memberIds,
			is_private: isPrivate,
			description,
			avatar_id: avatarId,
		}),
	);
}

export async function apiGetChannel(id: string) {
	return request<Channel>(apiClient.get(`/api/channels/${id}`));
}

export async function apiJoinChannel(link: string) {
	return request<Channel>(apiClient.post(`/api/join/${link}`));
}

/** Resolves an invite link to a preview card without joining. */
export async function apiPreviewInvite(link: string) {
	return request<InvitePreview>(apiClient.get(`/api/join/${link}`));
}

/** Replaces a channel's invite link (admin+); the old link stops working. */
export async function apiRegenerateInvite(channelId: string) {
	return request<Channel>(apiClient.post(`/api/channels/${channelId}/invite/regenerate`));
}

export async function apiAddMember(channelId: string, userIds: string[]) {
	return request<AddMembersResponse>(
		apiClient.post(`/api/channels/${channelId}/members`, {
			user_ids: userIds,
		}),
	);
}

export async function apiUpdateChannel(
	id: string,
	data: { name?: string; description?: string; avatar_id?: string; is_private?: boolean },
) {
	return request<Channel>(apiClient.patch(`/api/channels/${id}`, data));
}

export async function apiDeleteChannel(id: string, forBoth: boolean = false) {
	return apiClient.delete(`/api/channels/${id}`, {
		params: { for_both: forBoth },
	});
}

export async function apiLeaveChannel(channelId: string, userId: string) {
	return apiClient.delete(`/api/channels/${channelId}/members/${userId}`);
}

export async function apiUpdateMemberRole(
	channelId: string,
	userId: string,
	role: number,
) {
	return apiClient.patch(`/api/channels/${channelId}/members/${userId}`, {
		role,
	});
}

export async function apiGetChannelMembers(channelId: string) {
	return fetchAllPages((c) => apiGetPage<User>(`/api/channels/${channelId}/members`, c));
}

/** The server caps a user search at 50 results in total, so this is at most one page. */
export async function apiSearchUsers(query: string) {
	return fetchAllPages((c) => apiGetPage<User>('/api/users', c, { q: query }));
}

// ─────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────
/**
 * Fetches one page of a channel's messages, newest first.
 *
 * @param id - Channel id.
 * @param limit - Page size, 1..100.
 * @param cursor - The previous page's `next_cursor` (opaque) to load the next older page.
 */
export async function apiListMessages(id: string, limit = 50, cursor?: string) {
	return apiGetPage<Message>(`/api/channels/${id}/messages`, cursor, {}, limit);
}

// ─────────────────────────────────────────────
// File Uploads
// ─────────────────────────────────────────────
export function getFileUrl(fileId: string): string {
	if (!fileId) return '';
	return `${BASE_URL}/api/files/${fileId}`;
}

export async function apiUploadFile(
	file: Blob,
	mimeType: string,
	thumbCipher?: string,
	thumbNonce?: string,
	onUploadProgress?: (progressEvent: any) => void,
	channelId?: string,
	isVideo?: boolean,
) {
	const formData = new FormData();
	formData.append('file', file, `upload.${mimeType.split('/')[1] ?? 'bin'}`);
	if (thumbCipher) formData.append('thumb_ciphertext', thumbCipher);
	if (thumbNonce) formData.append('thumb_nonce', thumbNonce);
	if (channelId) formData.append('channel_id', channelId);
	if (isVideo) formData.append('is_video', 'true');

	return request<UploadedFile>(
		apiClient.post('/api/files', formData, {
			headers: {
				'Content-Type': 'multipart/form-data',
			},
			onUploadProgress,
		}),
	);
}

export async function apiGetFile(
	fileId: string,
	onDownloadProgress?: (progressEvent: any) => void,
) {
	return request<ArrayBuffer>(
		apiClient.get(`/api/files/${fileId}`, {
			responseType: 'arraybuffer',
			onDownloadProgress,
		}),
	);
}

// ─────────────────────────────────────────────
// Presence
// ─────────────────────────────────────────────
export async function apiGetPresence(userId: string) {
	return request<Presence>(apiClient.get(`/api/users/${userId}/presence`));
}

export async function apiGetVersion() {
	// No extra .catch here (unlike an earlier version of this function) —
	// the response interceptor above already logs every API error centrally,
	// so adding one here just double-logged version-check failures.
	return request<VersionInfo>(apiClient.get('/api/version'));
}

/**
 * GET /api/version. Everything but `version` is absent on servers that predate the API standard, so the
 * extra fields are optional and consumers must tolerate that.
 */
export interface VersionInfo {
	version: string;
	udp_port?: number;
	api_version?: number;
	min_client_version?: string;
	capabilities?: string[];
}
