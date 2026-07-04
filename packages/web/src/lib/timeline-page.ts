import type { TimelineItem } from './domain';

/** (at, id) ascending — identical ordering to the replica's byAscendingTimeline. */
export function compareItems(a: TimelineItem, b: TimelineItem): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merge an older page beneath the loaded items: union by id (existing wins on a
 * duplicate — the newest projection of a memory), re-sorted ascending. Order-
 * independent so a late newest-refresh cannot corrupt the accumulated history.
 */
export function mergeOlderPage(existing: TimelineItem[], older: TimelineItem[]): TimelineItem[] {
  const byId = new Map<string, TimelineItem>();
  for (const it of older) byId.set(it.id, it);
  for (const it of existing) byId.set(it.id, it);
  return [...byId.values()].sort(compareItems);
}
