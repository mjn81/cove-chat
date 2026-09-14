// client.ts — Fully improved API client

import { logger } from '@/utils/logger';
import { isWails } from '@/utils/wails';
import axios, { AxiosError } from 'axios';

// ─────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────
const getBaseUrl = () => {
	const envUrl = import.meta.env.VITE_API_URL;
	
	// If an environment URL is provided and it's not localhost, use it
	if (envUrl && !envUrl.includes('localhost')) {
		return envUrl.replace(/\/$/, '');
	}

	// In production builds, we don't want to fallback to localhost:8080
	// unless specifically requested via environment variables.
	if (import.meta.env.PROD) {
		return envUrl ? envUrl.replace(/\/$/, '') : '';
	}

	if (typeof window !== 'undefined') {
		const host = window.location.hostname;
		if (host === '[::1]' || host === '127.0.0.1' || host === 'localhost') {
			// Use 127.0.0.1 explicitly to avoid IPv6/IPv4 cookie mismatches
			return `http://127.0.0.1:8080`;
		}
	}
	return (envUrl ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
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
			const token = localStorage.getItem('nodetalk_token');
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
			const csrf = getCookie('nodetalk_csrf');
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
	User,
} from '@/types/api';

// ─────────────────────────────────────────────
// Auth API
// ─────────────────────────────────────────────
export async function apiRegister(username: string, password: string) {
	return apiClient.post<{ id: string; username: string }>('/api/register', {
		username,
		password,
	}) as unknown as Promise<{ id: string; username: string }>;
}

export async function apiLogin(
	username: string,
	password: string,
): Promise<AuthUser> {
	return apiClient.post('/api/login', {
		username,
		password,
	}) as unknown as Promise<AuthUser>;
}

export async function apiLogout() {
	return apiClient.post('/api/logout');
}

export async function apiMe() {
	return apiClient.get<AuthUser>('/api/me') as unknown as Promise<AuthUser>;
}

export async function apiUpdateProfile(data: {
	avatar_id?: string;
	username?: string;
	custom_msg?: string;
	status_preference?: string;
	password?: string;
	old_password?: string;
}) {
	return apiClient.patch<AuthUser>(
		'/api/users/me',
		data,
	) as unknown as Promise<AuthUser>;
}

export async function apiDeleteAccount() {
	return apiClient.delete('/api/users/me');
}

// ─────────────────────────────────────────────
// Channels
// ─────────────────────────────────────────────
export async function apiListChannels() {
	return apiClient
		.get<Channel[]>('/api/channels')
		.then((r) => (r as unknown as Channel[]) || []);
}

export async function apiExploreChannels(query: string) {
	return apiClient
		.get<
			ExploreChannel[]
		>(`/api/channels/explore?q=${encodeURIComponent(query)}`)
		.then((r) => (r as unknown as ExploreChannel[]) || []);
}

export async function apiCreateChannel(
	name: string,
	memberIds: string[],
	isPrivate: boolean,
) {
	return apiClient.post<Channel>('/api/channels', {
		name,
		members: memberIds,
		is_private: isPrivate,
	}) as unknown as Promise<Channel>;
}

export async function apiGetChannel(id: string) {
	return apiClient.get<Channel>(
		`/api/channels/${id}`,
	) as unknown as Promise<Channel>;
}

export async function apiJoinChannel(link: string) {
	return apiClient.post<Channel>(
		`/api/join/${link}`,
	) as unknown as Promise<Channel>;
}

export async function apiAddMember(channelId: string, userIds: string[]) {
	return apiClient.post(`/api/channels/${channelId}/members`, {
		user_ids: userIds,
	});
}

export async function apiUpdateChannel(
	id: string,
	data: { name?: string; is_private?: boolean },
) {
	return apiClient.patch<Channel>(
		`/api/channels/${id}`,
		data,
	) as unknown as Promise<Channel>;
}

export async function apiDeleteChannel(id: string) {
	return apiClient.delete(`/api/channels/${id}`);
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
	return apiClient
		.get<User[]>(`/api/channels/${channelId}/members`)
		.then((r) => (r as unknown as User[]) || []);
}

export async function apiSearchUsers(query: string) {
	return apiClient
		.get<User[]>(`/api/users?q=${encodeURIComponent(query)}`)
		.then((r) => (r as unknown as User[]) || []);
}

// ─────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────
export async function apiListMessages(id: string, limit = 50, before?: string) {
	const query = new URLSearchParams({ limit: limit.toString() });
	if (before) query.append('before', before);
	return apiClient
		.get<Message[]>(`/api/channels/${id}/messages?${query.toString()}`)
		.then((r) => (r as unknown as Message[]) || []);
}

// ─────────────────────────────────────────────
// File Uploads
// ─────────────────────────────────────────────
export async function apiUploadFile(
	file: Blob,
	mimeType: string,
	thumbCipher?: string,
	thumbNonce?: string,
	onUploadProgress?: (progressEvent: any) => void,
	channelId?: string,
) {
	const formData = new FormData();
	formData.append('file', file, `upload.${mimeType.split('/')[1] ?? 'bin'}`);
	if (thumbCipher) formData.append('thumb_ciphertext', thumbCipher);
	if (thumbNonce) formData.append('thumb_nonce', thumbNonce);
	if (channelId) formData.append('channel_id', channelId);

	return apiClient.post('/api/files', formData, {
		headers: {
			'Content-Type': 'multipart/form-data',
		},
		onUploadProgress,
	});
}

export async function apiGetFile(
	fileId: string,
	onDownloadProgress?: (progressEvent: any) => void,
): Promise<ArrayBuffer> {
	return apiClient.get(`/api/files/${fileId}`, {
		responseType: 'arraybuffer',
		onDownloadProgress,
	}) as Promise<ArrayBuffer>;
}

// ─────────────────────────────────────────────
// Presence
// ─────────────────────────────────────────────
export async function apiGetPresence(userId: string) {
	return apiClient.get<Presence>(
		`/api/users/${userId}/presence`,
	) as unknown as Promise<Presence>;
}

export async function apiGetVersion() {
	return apiClient.get<{ version: string }>('/api/version').catch((err) => {
		logger.error('Version fetch error', err);
		throw err;
	}) as unknown as Promise<{ version: string }>;
}
