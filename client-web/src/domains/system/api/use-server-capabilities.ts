import { useQuery } from '@tanstack/react-query';
import { apiGetVersion } from '@/api/client';
import { hasCapability, type Capability } from '@/lib/api-standard';

/** Query key for GET /api/version; shared so the version gate and feature gates use one request. */
export const SERVER_VERSION_KEY = ['server-version'] as const;

/**
 * Loads the server's version block and exposes capability gating. UI that depends on an optional server
 * feature checks `supports(...)` instead of comparing version numbers (docs/api-standard.md section 6).
 *
 * @returns `capabilities` (empty until known or on an old server), `minClientVersion`, `isLoaded`, and
 * `supports(name)`, which is false until the server has answered.
 */
export function useServerCapabilities() {
	const query = useQuery({ queryKey: SERVER_VERSION_KEY, queryFn: apiGetVersion, retry: false, staleTime: 5 * 60_000 });
	const capabilities = query.data?.capabilities;
	return {
		capabilities: capabilities ?? [],
		minClientVersion: query.data?.min_client_version,
		isLoaded: query.isSuccess,
		supports: (name: Capability) => hasCapability(capabilities, name),
	};
}
