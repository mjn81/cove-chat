import { apiClient, request } from '@/api/client';
import type {
	AdminAccount,
	AdminOverview,
	AuditEntry,
	ConfigSetting,
	ConfigValue,
	CreateInviteInput,
	Invite,
	NoticeResult,
	ServerUpdateInfo,
	ServerUpdateStarted,
	ServerUploadInfo,
	UpdateConfigResult,
} from '../types/admin.types';

/** Query keys for the admin panel; invalidate through these, never by string. */
export const adminKeys = {
	all: ['admin'] as const,
	overview: () => ['admin', 'overview'] as const,
	config: () => ['admin', 'config'] as const,
	invites: () => ['admin', 'invites'] as const,
	admins: () => ['admin', 'admins'] as const,
	audit: () => ['admin', 'audit'] as const,
	update: () => ['admin', 'update'] as const,
};

export const adminOverview = () => request<AdminOverview>(apiClient.get('/api/admin/overview'));

export const adminGetConfig = () =>
	request<{ settings: ConfigSetting[] }>(apiClient.get('/api/admin/config'));

/** `password` is only needed when a change touches an owner-only setting. */
export const adminUpdateConfig = (changes: Record<string, ConfigValue>, password?: string) =>
	request<UpdateConfigResult>(apiClient.patch('/api/admin/config', { changes, password }));

export const adminListInvites = () =>
	request<{ invites: Invite[] }>(apiClient.get('/api/admin/invites'));

export const adminCreateInvite = (input: CreateInviteInput) =>
	request<Invite>(apiClient.post('/api/admin/invites', input));

export const adminRevokeInvite = (code: string) =>
	request<{ status: string }>(apiClient.delete(`/api/admin/invites/${encodeURIComponent(code)}`));

export const adminAudit = () =>
	request<{ entries: AuditEntry[] }>(apiClient.get('/api/admin/audit'));

export const adminListAdmins = () =>
	request<{ admins: AdminAccount[] }>(apiClient.get('/api/admin/admins'));

export const adminGrantAdmin = (username: string, password: string) =>
	request<{ status: string }>(
		apiClient.put(`/api/admin/admins/${encodeURIComponent(username)}`, { password }),
	);

export const adminRevokeAdmin = (username: string, password: string) =>
	request<{ status: string }>(
		apiClient.delete(`/api/admin/admins/${encodeURIComponent(username)}`, { data: { password } }),
	);

export const adminTransferOwner = (username: string, password: string, confirm: string) =>
	request<{ status: string }>(
		apiClient.post('/api/admin/owner/transfer', { username, password, confirm }),
	);

/** Resolves to the encrypted archive bytes. */
export const adminBackup = (password: string, passphrase: string) =>
	request<Blob>(
		apiClient.post('/api/admin/backup', { password, passphrase }, { responseType: 'blob' }),
	);

/** Replaces all server data with an uploaded backup; everyone is signed out afterwards. */
export const adminRestore = (file: File, passphrase: string, password: string) => {
	const form = new FormData();
	// The server verifies the password before reading the (large) archive, so the file must be the last part.
	form.append('password', password);
	form.append('confirm', 'RESTORE');
	form.append('passphrase', passphrase);
	form.append('file', file);
	return request<{ status: string }>(apiClient.post('/api/admin/restore', form));
};

export const adminReset = (password: string, confirm: string) =>
	request<{ status: string }>(apiClient.post('/api/admin/reset', { password, confirm }));

export const adminDeleteServer = (password: string, confirm: string) =>
	request<{ status: string }>(apiClient.post('/api/admin/delete', { password, confirm }));

/** Owner only: delivers `text` from the server's Cove account to every user. */
export const adminSendNotice = (text: string) =>
	request<NoticeResult>(apiClient.post('/api/admin/notices', { text }));

/** Current vs latest release and update capability; `refresh` bypasses the server's 10-minute release cache. */
export const adminUpdateInfo = (refresh = false) =>
	request<ServerUpdateInfo>(apiClient.get('/api/admin/update', { params: refresh ? { refresh: 1 } : undefined }));

/**
 * Owner only: downloads, verifies and installs the newest release, then the server restarts. Replacing the program
 * file needs the owner's password again, like a backup restore.
 */
export const adminStartUpdate = (source: 'release' | 'upload', password: string) =>
	request<ServerUpdateStarted>(apiClient.post('/api/admin/update', { source, password }));

/** Owner only, non-Docker installs: stages a release zip or binary for an offline update. Nothing is applied yet. */
export const adminUploadUpdate = (input: {
	file: File;
	version: string;
	password: string;
	sha256?: string;
	sums?: string;
}) => {
	const form = new FormData();
	// The server checks the password before it reads the file, so it has to come first.
	form.append('password', input.password);
	form.append('version', input.version);
	if (input.sha256) form.append('sha256', input.sha256);
	if (input.sums) form.append('sums', input.sums);
	// The file goes last so the server can validate the small fields without waiting for the whole upload.
	form.append('file', input.file);
	return request<{ status: string; upload: ServerUploadInfo }>(apiClient.post('/api/admin/update/upload', form));
};
