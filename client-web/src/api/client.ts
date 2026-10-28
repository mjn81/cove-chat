// client.ts — Fully improved API client

import { logger } from '@/utils/logger';
import { isWails } from '@/utils/wails';
import axios, { AxiosError } from 'axios';
import type { PublicServerInfo } from '@/domains/auth/types/auth.types';

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

	constructor(status: number, message: string, data?: unknown) {
		super(message);
		this.status = status;
		this.data = data;
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
	if (isWails()) {
		try {
			const token = localStorage.getItem('cove_token');
			if (token) {
				config.headers.set('Authorization', `Bearer ${token}`);
			}
		} catch {
			// Ignore access errors
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
		const message = data?.error || error.message || `HTTP ${status}`;

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
export async function apiRegister(username: string, password: string, inviteCode?: string, turnstileToken?: string) {
	return request<{ id: string; username: string }>(
		apiClient.post('/api/register', {
			username,
			password,
			...(inviteCode ? { invite_code: inviteCode } : {}),
			...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
		}),
	);
}

/** Public sign-up policy, so the register page can adapt before the user types. */
export async function apiServerInfo() {
	return request<PublicServerInfo>(apiClient.get('/api/server-info'));
}

export async function apiLogin(username: string, password: string) {
	return request<AuthUser>(apiClient.post('/api/login', { username, password }));
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

export async function apiDeleteAccount() {
	return apiClient.delete('/api/users/me');
}

// ─────────────────────────────────────────────
// Relationships (Friends & Blocking)
// ─────────────────────────────────────────────
export async function apiGetMyRelationships() {
	return request<RelationshipResponse[]>(apiClient.get('/api/relationships')).then((r) => r || []);
}

export async function apiGetIncomingRequests() {
	return request<RelationshipResponse[]>(apiClient.get('/api/relationships/incoming')).then((r) => r || []);
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
	return request<Channel[]>(apiClient.get('/api/channels')).then((r) => r || []);
}

export async function apiExploreChannels(query: string) {
	return request<ExploreChannel[]>(
		apiClient.get(`/api/channels/explore?q=${encodeURIComponent(query)}`),
	).then((r) => r || []);
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
	return request<User[]>(
		apiClient.get(`/api/channels/${channelId}/members`),
	).then((r) => r || []);
}

export async function apiSearchUsers(query: string) {
	return request<User[]>(
		apiClient.get(`/api/users?q=${encodeURIComponent(query)}`),
	).then((r) => r || []);
}

// ─────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────
export async function apiListMessages(id: string, limit = 50, before?: string) {
	const query = new URLSearchParams({ limit: limit.toString() });
	if (before) query.append('before', before);
	return request<Message[]>(
		apiClient.get(`/api/channels/${id}/messages?${query.toString()}`),
	).then((r) => r || []);
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
	return request<{ version: string }>(apiClient.get('/api/version'));
}
