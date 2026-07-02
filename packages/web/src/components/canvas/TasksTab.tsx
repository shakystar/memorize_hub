import { ArrowRight, Check, CircleDashed, CircleHelp, Square, TriangleAlert, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { Priority, TaskEntry, TaskStatus } from '@/lib/domain';

/**
 * The tasks tab — the workspace's task base in Notion-database grammar
 * (docs/design/workspace-canvas-features.md §3): one data set, multiple
 * views (board by status / list by source project), property filters, and
 * a detail peek panel. handoff_ready is the hero status — memorize's
 * signature state, the ball someone should pick up. Read-only: status
 * changes come from agents until UI authoring (§5 phase 2). No date
 * views: the domain has no due/start fields.
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
  const [view, setView] = useState<'board' | 'list'>('board');
  const [member, setMember] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('task'),
  );

  if (tasks.length === 0) return <>{emptyState}</>;

  const members = [...new Set(tasks.map((t) => t.member))];
  const visible = tasks
    .filter((t) => (member ? t.member === member : true))
    .filter((t) => (priority ? t.priority === priority : true));
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex min-h-full items-stretch">
      <div className="min-w-0 flex-1 px-6 py-4">
        <div className="flex flex-wrap items-center gap-1.5 pb-4">
          {mock && (
            <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
              Mock data — dev only
            </span>
          )}
          <span className="flex overflow-hidden rounded-md border border-border text-xs">
            {(['board', 'list'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'px-2.5 py-1',
                  view === v ? 'bg-secondary font-medium' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v === 'board' ? 'Board' : 'List'}
              </button>
            ))}
          </span>
          <span className="mx-1 h-4 w-px bg-border" />
          <FilterChip label="Everyone" active={member === null} onClick={() => setMember(null)} />
          {members.map((m) => (
            <FilterChip key={m} label={shortName(m)} active={member === m} onClick={() => setMember(m)} />
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <FilterChip
            label={`Priority: ${priority ? PRIORITY_LABEL[priority] : 'All'}`}
            active={priority !== null}
            onClick={() => setPriority(NEXT_PRIORITY[priority ?? 'null'] ?? null)}
          />
        </div>

        {view === 'board' ? (
          <Board tasks={visible} selectedId={selectedId} onSelect={setSelectedId} />
        ) : (
          <List tasks={visible} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </div>

      {selected && <DetailPanel task={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'handoff_ready', 'blocked', 'done', 'cancelled'];
const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'handoff_ready', 'blocked', 'done'];
const BOARD_HIDDEN: TaskStatus[] = ['cancelled'];

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  handoff_ready: 'Handoff ready',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_RANK: Record<Priority, number> = { high: 2, medium: 1, low: 0 };
const NEXT_PRIORITY: Record<string, Priority | null> = {
  null: 'high',
  high: 'medium',
  medium: 'low',
  low: null,
};

function byPriorityThenRecency(a: TaskEntry, b: TaskEntry): number {
  return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.at.localeCompare(a.at);
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs',
        active
          ? 'border-primary bg-secondary font-medium text-foreground'
          : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

/* ---------- board view ---------- */

function Board({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: TaskEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hidden = tasks.filter((t) => BOARD_HIDDEN.includes(t.status));
  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-2">
      {BOARD_COLUMNS.map((status) => {
        const column = tasks.filter((t) => t.status === status).sort(byPriorityThenRecency);
        if (column.length === 0) return null;
        const hero = status === 'handoff_ready';
        return (
          <section key={status} className="w-64 shrink-0">
            <h2
              className={cn(
                'flex items-center gap-1.5 pb-2 text-xs font-medium uppercase tracking-wide',
                hero ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className={cn('size-1.5 rounded-full', hero ? 'bg-primary' : 'bg-border')} />
              {STATUS_LABEL[status]} ({column.length})
            </h2>
            <ul className="space-y-2">
              {column.map((t) => (
                <TaskCard key={t.id} task={t} hero={hero} selected={t.id === selectedId} onSelect={onSelect} />
              ))}
            </ul>
          </section>
        );
      })}
      {hidden.length > 0 && (
        <div className="w-56 shrink-0 pt-1">
          <h2 className="text-xs font-medium text-muted-foreground">Hidden groups</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {BOARD_HIDDEN.filter((s) => hidden.some((t) => t.status === s))
              .map((s) => `${STATUS_LABEL[s]} (${hidden.filter((t) => t.status === s).length})`)
              .join(' · ')}
          </p>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  hero,
  selected,
  onSelect,
}: {
  task: TaskEntry;
  hero: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const closed = task.status === 'done';
  return (
    <li>
      <button
        onClick={() => onSelect(task.id)}
        className={cn(
          'w-full rounded-lg border bg-card px-3 py-2.5 text-left hover:border-muted-foreground/40',
          hero ? 'border-primary/40' : 'border-border',
          selected && 'ring-1 ring-primary',
          closed && 'opacity-70',
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className={cn('min-w-0 text-sm', closed && 'line-through')}>{task.title}</span>
          <PriorityBadge priority={task.priority} />
        </span>
        {task.handoff && (
          <span className="mt-2 flex items-start gap-1.5 rounded-md bg-secondary px-2 py-1.5 text-xs">
            <ArrowRight className="mt-px size-3.5 shrink-0 text-primary" />
            <span className="min-w-0">{task.handoff.nextAction}</span>
          </span>
        )}
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {shortName(task.member)} · {task.ownerType === 'human' ? 'human' : task.writer} ·{' '}
            {task.sourceProjectLabel ?? task.sourceProjectId}
          </span>
          <ShortDate at={task.at} className="ml-auto shrink-0" />
        </span>
      </button>
    </li>
  );
}

/* ---------- list view ---------- */

/** Notion's "By project" list: grouped by source project, status as a column. */
function List({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: TaskEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const labels = [...new Set(tasks.map(sourceLabel))];
  return (
    <div className="max-w-3xl">
      {labels.map((label) => {
        const rows = tasks
          .filter((t) => sourceLabel(t) === label)
          .sort(
            (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byPriorityThenRecency(a, b),
          );
        return (
          <section key={label} className="mb-6">
            <h2 className="pb-2 text-xs font-medium text-muted-foreground">
              {label} <span className="font-normal">({rows.length})</span>
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {rows.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => onSelect(t.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/50',
                      t.id === selectedId && 'bg-secondary/70',
                    )}
                  >
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm',
                        (t.status === 'done' || t.status === 'cancelled') && 'text-muted-foreground line-through',
                      )}
                    >
                      {t.title}
                    </span>
                    <StatusPill status={t.status} />
                    <PriorityBadge priority={t.priority} />
                    <span className="hidden w-16 truncate text-xs text-muted-foreground sm:block">
                      {shortName(t.member)}
                    </span>
                    <ShortDate at={t.at} className="hidden w-12 text-right sm:block" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ---------- detail peek panel ---------- */

function DetailPanel({ task, onClose }: { task: TaskEntry; onClose: () => void }) {
  return (
    <aside className="sticky top-0 h-fit max-h-[85vh] w-96 shrink-0 overflow-y-auto border-l border-border px-5 py-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold">{task.title}</h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <Property label="Status">
          <StatusPill status={task.status} />
        </Property>
        <Property label="Priority">{PRIORITY_LABEL[task.priority]}</Property>
        <Property label="Owner">
          {shortName(task.member)} · {task.ownerType}
        </Property>
        <Property label="Agent">{task.writer}</Property>
        <Property label="Source">{task.sourceProjectLabel ?? task.sourceProjectId}</Property>
        <Property label="Updated">
          <ShortDate at={task.at} />
        </Property>
      </dl>

      {task.goal && <Section title="Goal">{task.goal}</Section>}
      {task.description && <Section title="Description">{task.description}</Section>}
      {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
        <Section title="Acceptance criteria">
          <ItemList icon={<Square className="size-3.5" />} items={task.acceptanceCriteria} />
        </Section>
      )}
      {task.openQuestions && task.openQuestions.length > 0 && (
        <Section title="Open questions">
          <ItemList icon={<CircleHelp className="size-3.5" />} items={task.openQuestions} />
        </Section>
      )}
      {task.riskNotes && task.riskNotes.length > 0 && (
        <Section title="Risk notes">
          <ItemList icon={<TriangleAlert className="size-3.5" />} items={task.riskNotes} />
        </Section>
      )}

      {task.handoff && (
        <div className="mt-5 rounded-lg border border-primary/40 bg-secondary/50 p-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-primary">Handoff</h3>
          <p className="mt-2 text-sm">{task.handoff.summary}</p>
          <p className="mt-2 flex items-start gap-1.5 text-sm">
            <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 font-medium">{task.handoff.nextAction}</span>
          </p>
          {task.handoff.doneItems && task.handoff.doneItems.length > 0 && (
            <ItemList
              className="mt-2"
              icon={<Check className="size-3.5 text-muted-foreground" />}
              items={task.handoff.doneItems}
              muted
            />
          )}
          {task.handoff.remainingItems && task.handoff.remainingItems.length > 0 && (
            <ItemList
              className="mt-1"
              icon={<CircleDashed className="size-3.5" />}
              items={task.handoff.remainingItems}
            />
          )}
        </div>
      )}
    </aside>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-1.5 text-sm">{children}</div>
    </div>
  );
}

function ItemList({
  icon,
  items,
  muted,
  className,
}: {
  icon: ReactNode;
  items: string[];
  muted?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn('space-y-1', className)}>
      {items.map((item) => (
        <li key={item} className={cn('flex items-start gap-1.5 text-sm', muted && 'text-muted-foreground')}>
          <span className="mt-0.5 shrink-0">{icon}</span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- shared bits ---------- */

function StatusPill({ status }: { status: TaskStatus }) {
  const hero = status === 'handoff_ready';
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-1.5 py-px text-[11px]',
        hero ? 'border-primary/50 text-primary' : 'border-border text-muted-foreground',
      )}
    >
      {STATUS_LABEL[status]}
    </span>
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
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

function ShortDate({ at, className }: { at: string; className?: string }) {
  return (
    <time dateTime={at} className={cn('text-xs tabular-nums text-muted-foreground', className)}>
      {new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
    </time>
  );
}

function sourceLabel(t: TaskEntry): string {
  return t.sourceProjectLabel ?? t.sourceProjectId;
}

function shortName(email: string): string {
  return email.split('@')[0] ?? email;
}
