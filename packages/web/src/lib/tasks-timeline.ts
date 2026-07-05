import type { TaskEntry, TaskStatus } from './domain';

const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['done', 'cancelled']);

export interface TimelineSegments {
  /** wait (todo) segment — always present. Epoch ms. */
  waitStart: number;
  waitEnd: number;
  /** work (in_progress) segment — present only when the task started. */
  workStart?: number;
  workEnd?: number;
  /** terminal with no work segment → render a ◇ marker at waitEnd. */
  milestone: boolean;
  /** where an incoming dependency arrow lands: startedAt ?? createdAt. Epoch ms. */
  arrowAnchor: number;
}

/** The task's right edge on the axis: last transition if terminal, else now. */
function endOf(task: TaskEntry, now: number): number {
  return TERMINAL.has(task.status) ? Date.parse(task.at) : now;
}

export function computeSegments(task: TaskEntry, now: number): TimelineSegments {
  const created = Date.parse(task.createdAt);
  const started = task.startedAt ? Date.parse(task.startedAt) : undefined;
  const end = endOf(task, now);
  const waitEnd = started ?? end;
  const milestone = started === undefined && TERMINAL.has(task.status);
  return {
    waitStart: created,
    waitEnd,
    ...(started !== undefined ? { workStart: started, workEnd: end } : {}),
    milestone,
    arrowAnchor: started ?? created,
  };
}

export function timeDomain(tasks: TaskEntry[], now: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of tasks) {
    lo = Math.min(lo, Date.parse(t.createdAt));
    hi = Math.max(hi, endOf(t, now));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [now, now + 1];
  // Guard a zero-width domain so bars/scale never divide by zero.
  if (hi <= lo) hi = lo + 60_000;
  return [lo, hi];
}

/**
 * Predecessors before successors (arrows flow downward). Ties broken by
 * createdAt then id. DFS post-order; cycle-safe — a node already on the current
 * stack is skipped, and any node left unvisited by cycles is appended.
 */
export function topoOrder(tasks: TaskEntry[]): TaskEntry[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const sorted = [...tasks].sort((a, b) =>
    a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1,
  );
  const out: TaskEntry[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  const visit = (t: TaskEntry): void => {
    if (done.has(t.id) || onStack.has(t.id)) return;
    onStack.add(t.id);
    for (const depId of t.dependsOn ?? []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    onStack.delete(t.id);
    done.add(t.id);
    out.push(t);
  };
  for (const t of sorted) visit(t);
  return out;
}

export function linearScale(
  domain: [number, number],
  range: [number, number],
): (t: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (t: number) => r0 + ((t - d0) / span) * (r1 - r0);
}
