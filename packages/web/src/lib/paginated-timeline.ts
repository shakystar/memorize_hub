import { useCallback, useEffect, useRef, useState } from 'react';

import { getWorkspaceTimeline } from './api';
import type { TimelineItem } from './domain';
import { mergeOlderPage } from './timeline-page';

const PAGE_SIZE = 50;

export interface PaginatedTimeline {
  items: TimelineItem[];
  /** Fetching the first page with an empty cache — the only spinner state. */
  loading: boolean;
  error?: string;
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}

/**
 * Backward-paginating timeline feed. Mirrors useLiveFeed's stale-while-
 * revalidate cache for the NEWEST page (instant paint on reload), then
 * accumulates older pages by prepend on loadOlder(). One fetch per mount (no
 * polling), so there is no newest-refresh vs older-page race within a session.
 */
export function usePaginatedTimeline(workspaceId: string, enabled: boolean): PaginatedTimeline {
  const key = `hub:timeline:${workspaceId}`;
  const [items, setItems] = useState<TimelineItem[]>(() => (enabled ? readCache(key) ?? [] : []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const activeKey = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    activeKey.current = key;
    const cached = readCache(key);
    setItems(cached ?? []);
    setLoading(!cached);
    setError(undefined);
    setLoadingOlder(false);
    cursorRef.current = undefined;
    getWorkspaceTimeline(workspaceId, { limit: PAGE_SIZE })
      .then((res) => {
        if (activeKey.current !== key) return; // workspace moved on
        writeCache(key, res.items);
        setItems(res.items);
        setHasMore(res.hasMore);
        cursorRef.current = res.nextCursor;
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (activeKey.current !== key) return;
        setLoading(false);
        if (!cached) setError(e instanceof Error ? e.message : String(e));
      });
  }, [enabled, key, workspaceId]);

  const loadOlder = useCallback(() => {
    if (!hasMore || loadingOlder) return;
    const cursor = cursorRef.current;
    if (!cursor) return;
    setLoadingOlder(true);
    getWorkspaceTimeline(workspaceId, { limit: PAGE_SIZE, before: cursor })
      .then((res) => {
        if (activeKey.current !== key) return;
        setItems((prev) => mergeOlderPage(prev, res.items));
        setHasMore(res.hasMore);
        cursorRef.current = res.nextCursor;
        setLoadingOlder(false);
      })
      .catch(() => {
        if (activeKey.current !== key) return;
        setLoadingOlder(false); // keep what we have; scrolling retriggers
      });
  }, [hasMore, loadingOlder, workspaceId, key]);

  return { items, loading, error, hasMore, loadingOlder, loadOlder };
}

const memoryCache = new Map<string, TimelineItem[]>();

function readCache(key: string): TimelineItem[] | undefined {
  const inMemory = memoryCache.get(key);
  if (inMemory) return inMemory;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TimelineItem[]) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, items: TimelineItem[]): void {
  memoryCache.set(key, items);
  try {
    sessionStorage.setItem(key, JSON.stringify(items));
  } catch {
    // quota / private mode: in-memory copy still covers this tab
  }
}
