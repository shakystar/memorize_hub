import { useEffect, useRef, useState } from 'react';

/**
 * Stale-while-revalidate fetch for the canvas's live read surfaces (Timeline,
 * Tasks). Every replica read costs a relay pull plus a Fly round-trip, so the
 * hook renders the last known items instantly (session cache) and refreshes in
 * the background; `loading` is true only when there is nothing cached to show.
 *
 * Cache = in-memory map (tab lifetime) mirrored to sessionStorage (survives
 * reload, not shared across tabs, gone with the browser session — deliberately
 * NOT localStorage: workspace data should not outlive the login session on a
 * shared machine).
 *
 * Staleness is keyed on `key`, not an effect-cleanup flag: state the effect
 * itself writes must never be a dependency (that cleanup-cancel loop was the
 * "Loading tasks" hang, #58).
 */
export interface LiveFeed<T> {
  items: T[];
  /** Fetching with an empty cache — the only state that shows a spinner. */
  loading: boolean;
  /** Last fetch failed AND nothing cached — stale data beats an error page. */
  error?: string;
}

const memoryCache = new Map<string, unknown[]>();

function readCache<T>(key: string): T[] | undefined {
  const inMemory = memoryCache.get(key) as T[] | undefined;
  if (inMemory) return inMemory;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache<T>(key: string, items: T[]): void {
  memoryCache.set(key, items);
  try {
    sessionStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Quota or private mode: the in-memory copy still covers this tab.
  }
}

export function useLiveFeed<T>(
  key: string,
  enabled: boolean,
  fetcher: () => Promise<T[]>,
): LiveFeed<T> {
  const [state, setState] = useState<LiveFeed<T>>(() => ({
    items: (enabled ? readCache<T>(key) : undefined) ?? [],
    loading: false,
  }));
  // The fetcher is a fresh closure every render; a ref keeps it OUT of the
  // effect dependencies so only enabled/key trigger a refetch.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const activeKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    activeKey.current = key;
    const cached = readCache<T>(key);
    setState({ items: cached ?? [], loading: !cached });
    fetcherRef
      .current()
      .then((items) => {
        if (activeKey.current !== key) return; // workspace moved on: drop stale
        writeCache(key, items);
        setState({ items, loading: false });
      })
      .catch((error: unknown) => {
        if (activeKey.current !== key) return;
        setState({
          items: cached ?? [],
          loading: false,
          ...(cached
            ? {} // stale data on screen beats an error page
            : { error: error instanceof Error ? error.message : String(error) }),
        });
      });
  }, [enabled, key]);

  return state;
}
