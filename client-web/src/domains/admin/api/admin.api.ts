import { apiClient, request } from '@/api/client';
import type {
	AdminAccount,
	AdminOverview,
	AuditEntry,
	ConfigSetting,
	ConfigValue,
	CreateInviteInput,
	Invite,
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
	form.append('file', file);
	form.append('passphrase', passphrase);
	form.append('password', password);
	form.append('confirm', 'RESTORE');
	return request<{ status: string }>(apiClient.post('/api/admin/restore', form));
};

export const adminReset = (password: string, confirm: string) =>
	request<{ status: string }>(apiClient.post('/api/admin/reset', { password, confirm }));

export const adminDeleteServer = (password: string, confirm: string) =>
	request<{ status: string }>(apiClient.post('/api/admin/delete', { password, confirm }));
