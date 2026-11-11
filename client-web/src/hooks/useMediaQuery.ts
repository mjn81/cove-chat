import { useCallback, useSyncExternalStore } from 'react';

/** One shared MediaQueryList per query string, with a single native listener fanning out to every subscriber. */
interface SharedQuery {
  list: MediaQueryList;
  subscribers: Set<() => void>;
  onChange: () => void;
}

// Message rows, sidebars and pages all ask the same few queries. Without sharing, every mounted row added its own
// native listener and built a new MediaQueryList on every snapshot read. Entries live only while someone is
// subscribed, so nothing outlives the components using it.
const shared = new Map<string, SharedQuery>();

function subscribeToQuery(query: string, callback: () => void): () => void {
  let entry = shared.get(query);
  if (!entry) {
    const list = window.matchMedia(query);
    const subscribers = new Set<() => void>();
    const onChange = () => subscribers.forEach((fn) => fn());
    list.addEventListener('change', onChange);
    entry = { list, subscribers, onChange };
    shared.set(query, entry);
  }
  entry.subscribers.add(callback);
  return () => {
    const current = shared.get(query);
    if (!current) return;
    current.subscribers.delete(callback);
    if (current.subscribers.size === 0) {
      current.list.removeEventListener('change', current.onChange);
      shared.delete(query);
    }
  };
}

/**
 * Tracks a CSS media query (for example `(max-width: 768px)`).
 *
 * @param query - The media query string.
 * @returns whether it currently matches; always `false` where `matchMedia` is unavailable.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((callback: () => void) => subscribeToQuery(query, callback), [query]);
  const getSnapshot = useCallback(
    () => (shared.get(query)?.list ?? window.matchMedia(query)).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
