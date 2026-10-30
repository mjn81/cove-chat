import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	adminAudit,
	adminCreateInvite,
	adminGetConfig,
	adminGrantAdmin,
	adminKeys,
	adminListAdmins,
	adminListInvites,
	adminOverview,
	adminRevokeAdmin,
	adminRevokeInvite,
	adminSendNotice,
	adminTransferOwner,
	adminUpdateConfig,
} from './admin.api';
import type { ConfigValue, CreateInviteInput } from '../types/admin.types';

/** Dashboard numbers for the Overview section. */
export const useAdminOverview = () =>
	useQuery({ queryKey: adminKeys.overview(), queryFn: adminOverview, refetchInterval: 30_000 });

/** Editable server settings with their saved values. */
export const useAdminConfig = () =>
	useQuery({ queryKey: adminKeys.config(), queryFn: adminGetConfig });

/** Saves settings; refreshes the config, overview (registration mode) and audit views. */
export function useUpdateAdminConfig() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (v: { changes: Record<string, ConfigValue>; password?: string }) =>
			adminUpdateConfig(v.changes, v.password),
		onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.all }),
	});
}

export const useAdminInvites = () =>
	useQuery({ queryKey: adminKeys.invites(), queryFn: adminListInvites });

export function useCreateInvite() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateInviteInput) => adminCreateInvite(input),
		onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.all }),
	});
}

export function useRevokeInvite() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (code: string) => adminRevokeInvite(code),
		onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.all }),
	});
}

export const useAdminAudit = () => useQuery({ queryKey: adminKeys.audit(), queryFn: adminAudit });

export const useAdminAccounts = () =>
	useQuery({ queryKey: adminKeys.admins(), queryFn: adminListAdmins });

export function useGrantAdmin() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (v: { username: string; password: string }) =>
			adminGrantAdmin(v.username, v.password),
		onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.all }),
	});
}

export function useRevokeAdmin() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (v: { username: string; password: string }) =>
			adminRevokeAdmin(v.username, v.password),
		onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.all }),
	});
}

export function useTransferOwner() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (v: { username: string; password: string; confirm: string }) =>
			adminTransferOwner(v.username, v.password, v.confirm),
		onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.all }),
	});
}

/** Sends a server-wide notice; the audit log gains an entry, so it is refreshed. */
export function useSendNotice() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (text: string) => adminSendNotice(text),
		onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.audit() }),
	});
}
