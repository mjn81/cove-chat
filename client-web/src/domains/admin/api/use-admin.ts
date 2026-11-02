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
	adminStartUpdate,
	adminTransferOwner,
	adminUpdateConfig,
	adminUpdateInfo,
	adminUploadUpdate,
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

/**
 * Server update status. While this browser is installing `target`, it polls every 1.5 s until the server answers
 * idle on that version; a failed poll is expected during the restart, so retries are off and the previous data is
 * kept.
 *
 * @param target - Version being installed by this browser, or null when it started no update.
 */
export const useServerUpdate = (target: string | null = null) =>
	useQuery({
		queryKey: adminKeys.update(),
		queryFn: () => adminUpdateInfo(),
		staleTime: 60_000,
		retry: target === null ? 1 : false,
		refetchInterval: (query) => {
			if (target === null) return false;
			const data = query.state.data;
			return data?.state === 'idle' && data.current_version === target ? false : 1500;
		},
	});

/** "Check now": re-queries GitHub and stores the answer in the update query. */
export function useCheckServerUpdate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => adminUpdateInfo(true),
		onSuccess: (info) => {
			qc.setQueryData(adminKeys.update(), info);
			void qc.invalidateQueries({ queryKey: adminKeys.audit() });
		},
	});
}

/** Owner only: starts the update job. Progress then comes from {@link useServerUpdate}. */
export function useStartServerUpdate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ source = 'release', password }: { source?: 'release' | 'upload'; password: string }) =>
			adminStartUpdate(source, password),
		onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.update() }),
	});
}

/** Owner only: uploads a release file for an offline update; the update status then shows it as staged. */
export function useUploadServerUpdate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: adminUploadUpdate,
		onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.update() }),
	});
}
