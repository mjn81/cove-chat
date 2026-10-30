import { apiClient, request } from '@/api/client';
import type { SessionInfo } from '../types/sessions.types';

/** Query keys for the signed-in devices list; invalidate through these, never by string. */
export const sessionKeys = {
	all: ['sessions'] as const,
};

/** Lists the caller's signed-in devices, most recently active first. */
export const listSessions = () => request<SessionInfo[]>(apiClient.get('/api/sessions'));

/** Ends one of the caller's own sessions by its public id. */
export const terminateSession = (id: string) =>
	request<{ status: string }>(apiClient.delete(`/api/sessions/${encodeURIComponent(id)}`));

/** Ends every session except the one making the request. */
export const terminateOtherSessions = () =>
	request<{ status: string }>(apiClient.post('/api/sessions/terminate-others'));
