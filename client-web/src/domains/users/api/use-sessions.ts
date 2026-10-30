import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listSessions, sessionKeys, terminateOtherSessions, terminateSession } from './sessions.api';

/** The caller's signed-in devices. */
export const useGetSessions = () =>
	useQuery({ queryKey: sessionKeys.all, queryFn: listSessions });

/** Terminates one device and refreshes the list. */
export function useTerminateSession() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => terminateSession(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: sessionKeys.all }),
	});
}

/** Terminates every device except this one and refreshes the list. */
export function useTerminateOtherSessions() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: terminateOtherSessions,
		onSuccess: () => qc.invalidateQueries({ queryKey: sessionKeys.all }),
	});
}
