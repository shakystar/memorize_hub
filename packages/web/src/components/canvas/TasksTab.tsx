import { ArrowRight } from 'lucide-react';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { Priority, TaskEntry, TaskStatus } from '@/lib/domain';

/**
 * The tasks tab — the workspace's task board in Notion-board grammar
 * (docs/design/workspace-canvas-features.md §3): one column per status,
 * handoff_ready as the hero column (memorize's signature state — the ball
 * someone should pick up), rarely-useful statuses collapsed into a hidden
 * group. Read-only: status changes come from agents until UI authoring
 * (§5 phase 2) lands.
 */
export function TasksTab({
  tasks,
  mock,
  emptyState,
}: {
  tasks: TaskEntry[];
  /** True when dev-only mock data — always badged, never silent. */
  mock?: boolean;
  emptyState: ReactNode;
}) {
  if (tasks.length === 0) return <>{emptyState}</>;

  const hidden = tasks.filter((t) => HIDDEN_STATUSES.includes(t.status));

  return (
    <div className="flex h-full flex-col px-6 py-4">
      {mock && (
        <span className="mb-4 self-start rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
          Mock data — dev only
        </span>
      )}
      <div className="flex min-h-0 flex-1 items-start gap-4 overflow-x-auto pb-2">
        {COLUMN_ORDER.map((status) => {
          const column = tasks
            .filter((t) => t.status === status)
            .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.at.localeCompare(a.at));
          if (column.length === 0) return null;
          return <Column key={status} status={status} tasks={column} />;
        })}
        {hidden.length > 0 && (
          <div className="w-56 shrink-0 pt-1">
            <h2 className="text-xs font-medium text-muted-foreground">Hidden groups</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {HIDDEN_STATUSES.filter((s) => hidden.some((t) => t.status === s))
                .map((s) => `${STATUS_LABEL[s]} (${hidden.filter((t) => t.status === s).length})`)
                .join(' · ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const COLUMN_ORDER: TaskStatus[] = ['todo', 'in_progress', 'handoff_ready', 'blocked', 'done'];
const HIDDEN_STATUSES: TaskStatus[] = ['cancelled'];

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  handoff_ready: 'Handoff ready',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

const PRIORITY_RANK: Record<Priority, number> = { high: 2, medium: 1, low: 0 };

function Column({ status, tasks }: { status: TaskStatus; tasks: TaskEntry[] }) {
  const hero = status === 'handoff_ready';
  return (
    <section className="w-64 shrink-0">
      <h2
        className={cn(
          'flex items-center gap-1.5 pb-2 text-xs font-medium uppercase tracking-wide',
          hero ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        <span className={cn('size-1.5 rounded-full', hero ? 'bg-primary' : 'bg-border')} />
        {STATUS_LABEL[status]} ({tasks.length})
      </h2>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} hero={hero} />
        ))}
      </ul>
    </section>
  );
}

function TaskCard({ task, hero }: { task: TaskEntry; hero: boolean }) {
  const closed = task.status === 'done';
  return (
    <li
      className={cn(
        'rounded-lg border bg-card px-3 py-2.5',
        hero ? 'border-primary/40' : 'border-border',
        closed && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn('min-w-0 text-sm', closed && 'line-through')}>{task.title}</p>
        <PriorityBadge priority={task.priority} />
      </div>
      {task.handoff && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-secondary px-2 py-1.5 text-xs">
          <ArrowRight className="mt-px size-3.5 shrink-0 text-primary" />
          <span className="min-w-0">{task.handoff.nextAction}</span>
        </p>
      )}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {shortName(task.member)} · {task.ownerType === 'human' ? 'human' : task.writer} ·{' '}
          {task.sourceProjectLabel ?? task.sourceProjectId}
        </span>
        <time dateTime={task.at} className="ml-auto shrink-0 tabular-nums">
          {new Date(task.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </time>
      </p>
    </li>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === 'low') return null;
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-1.5 py-px text-[11px]',
        priority === 'high' ? 'border-destructive/50 text-destructive' : 'border-border text-muted-foreground',
      )}
    >
      {priority === 'high' ? 'High' : 'Medium'}
    </span>
  );
}

function shortName(email: string): string {
  return email.split('@')[0] ?? email;
}
