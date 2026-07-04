/**
 * The workspace canvas tabs, in one place so both the canvas (rendering) and
 * the URL router (validation) share a single source of truth. `connect` is a
 * real tab but renders separately (right-aligned, non-demo only), so it lives
 * in the union + isTab guard but not in the left-aligned TABS list.
 */
export type Tab = 'timeline' | 'tasks' | 'talk' | 'decisions' | 'sources' | 'connect';

export const TABS: Array<{ id: Tab; label: string; tbd?: boolean }> = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'talk', label: 'Talk', tbd: true },
  { id: 'decisions', label: 'Decisions', tbd: true },
  { id: 'sources', label: 'Sources', tbd: true },
];

const TAB_IDS: readonly string[] = [...TABS.map((t) => t.id), 'connect'];

export function isTab(x: string | null | undefined): x is Tab {
  return x != null && TAB_IDS.includes(x);
}
