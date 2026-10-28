import { useQuery } from '@tanstack/react-query';
import { apiServerInfo } from '@/api/client';

/** Query key for the public server info; shared so the register page and the demo banner use one request. */
export const SERVER_INFO_KEY = ['server-info'] as const;

/**
 * Loads the public server info (sign-up policy, demo flag, bot-check key).
 *
 * @returns the React Query result; `data` is undefined until the server answers or when it is unreachable.
 */
export function useGetServerInfo() {
	return useQuery({ queryKey: SERVER_INFO_KEY, queryFn: apiServerInfo, retry: false });
}
