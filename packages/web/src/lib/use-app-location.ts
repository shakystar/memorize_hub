import { useCallback, useEffect, useState } from 'react';

import { isTab, type Tab } from '@/lib/tabs';

/**
 * Path-based routing for the /app SPA. The URL owns which workspace is open and
 * which tab is active, so refresh and shared links restore state. Query flags
 * (?demo, ?task=) live on top and are preserved across navigation.
 *
 *   /app                     -> default (resolver redirects to the first workspace)
 *   /app/personal            -> personal memory view
 *   /app/:workspaceId/:tab   -> a workspace + tab (workspaceId is the stable wsp_ id)
 */
export type Route =
  | { view: 'personal' }
  | { view: 'workspace'; workspaceId: string | null; tab: Tab };

const BASE = '/app';

export function parse(pathname: string): Route {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const segs = rest.split('/').filter(Boolean); // [] | ['personal'] | [id] | [id, tab]
  const [first, second] = segs;
  if (first === 'personal') return { view: 'personal' };
  if (first == null) return { view: 'workspace', workspaceId: null, tab: 'timeline' };
  const workspaceId = decodeURIComponent(first);
  const tab: Tab = isTab(second) ? second : 'timeline';
  return { view: 'workspace', workspaceId, tab };
}

export function toPath(route: Route): string {
  if (route.view === 'personal') return `${BASE}/personal`;
  if (route.workspaceId == null) return BASE;
  return `${BASE}/${encodeURIComponent(route.workspaceId)}/${route.tab}`;
}

export function useAppLocation(): {
  route: Route;
  navigate: (next: Route, opts?: { replace?: boolean }) => void;
} {
  const [route, setRoute] = useState<Route>(() => parse(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: Route, opts?: { replace?: boolean }) => {
    // Preserve the query string (?demo, ?task=) across path navigation.
    const url = toPath(next) + window.location.search;
    window.history[opts?.replace ? 'replaceState' : 'pushState'](null, '', url);
    setRoute(next);
  }, []);

  return { route, navigate };
}
