import {
  ArrowRightLeft,
  CircleCheckBig,
  CirclePlay,
  CircleStop,
  Gavel,
  RefreshCw,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { type DomainTimelineItem, type TimelineItem, isSyncItem } from '@/lib/domain';

/**
 * The workspace timeline — the canvas's primary view (activity feed, spec
 * docs/design/workspace-canvas-features.md §3). Day-grouped, filterable by
 * actor, every domain item labeled with its provenance ("who · from where").
 */
export function TimelineTab({
  items,
  mock,
  emptyState,
}: {
  items: TimelineItem[];
  /** True when the feed is dev-only mock data — always badged, never silent. */
  mock?: boolean;
  emptyState: ReactNode;
}) {
  const [actor, setActor] = useState<string | null>(null);

  const actors = useMemo(
    () => [...new Set(items.map((i) => (isSyncItem(i) ? i.member : i.writer)))],
    [items],
  );
  const visible = actor
    ? items.filter((i) => (isSyncItem(i) ? i.member : i.writer) === actor)
    : items;
  const days = useMemo(() => groupByDay(visible), [visible]);

  if (items.length === 0) return <>{emptyState}</>;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-4">
      <div className="flex flex-wrap items-center gap-1.5 pb-3">
        {mock && (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
            Mock data — dev only
          </span>
        )}
        <ActorChip label="Everyone" active={actor === null} onClick={() => setActor(null)} />
        {actors.map((a) => (
          <ActorChip key={a} label={a} active={actor === a} onClick={() => setActor(a)} />
        ))}
      </div>

      {days.map(([label, dayItems]) => (
        <section key={label}>
          <h2 className="sticky top-0 bg-background py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </h2>
          <ol className="mb-4 space-y-1">
            {dayItems.map((item) => (
              <li key={item.id}>
                <TimelineRow item={item} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function ActorChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

function TimelineRow({ item }: { item: TimelineItem }) {
  if (isSyncItem(item)) {
    return (
      <div className="flex items-center gap-3 rounded-md px-2 py-1 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {item.member} synced ({item.type === 'sync.push' ? 'sent updates' : 'received updates'})
        </span>
        <Time at={item.at} />
      </div>
    );
  }
  return <DomainRow item={item} />;
}

function DomainRow({ item }: { item: DomainTimelineItem }) {
  const { icon, badge, body, muted } = describe(item);
  return (
    <div className="flex gap-3 rounded-md px-2 py-2 hover:bg-secondary/50">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', muted && 'text-muted-foreground line-through')}>{body}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {badge}
          <span>
            {item.writer} · {item.sourceProjectLabel ?? item.sourceProjectId}
          </span>
          <Time at={item.at} />
        </p>
      </div>
    </div>
  );
}

const KIND_LABEL = { decision: 'Decision', rationale: 'Why', progress: 'Progress' } as const;

function describe(item: DomainTimelineItem): {
  icon: ReactNode;
  badge?: ReactNode;
  body: string;
  muted?: boolean;
} {
  switch (item.type) {
    case 'memory.consolidated':
      return {
        icon: <Sparkles />,
        badge: <Badge>{KIND_LABEL[item.kind]}</Badge>,
        body: item.text,
      };
    case 'memory.retracted':
      return { icon: <Undo2 />, badge: <Badge>Retracted</Badge>, body: item.text, muted: true };
    case 'decision.accepted':
      return { icon: <Gavel />, badge: <Badge>Decision</Badge>, body: item.title };
    case 'task.created':
      return { icon: <CircleCheckBig />, badge: <Badge>New task</Badge>, body: item.title };
    case 'task.updated':
      return {
        icon: <CircleCheckBig />,
        badge: <Badge>{item.status.replace('_', ' ')}</Badge>,
        body: item.title,
      };
    case 'handoff.created':
      return { icon: <ArrowRightLeft />, badge: <Badge>Handoff</Badge>, body: item.title };
    case 'session.started':
      return { icon: <CirclePlay />, body: `${item.agent} started a session` };
    case 'session.completed':
      return { icon: <CircleStop />, body: `${item.agent} finished a session` };
  }
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border px-1.5 py-px text-[11px]">{children}</span>
  );
}

function Time({ at }: { at: string }) {
  return (
    <time dateTime={at} className="ml-auto shrink-0 tabular-nums">
      {new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
    </time>
  );
}

function groupByDay(items: TimelineItem[]): Array<[string, TimelineItem[]]> {
  const sorted = [...items].sort((a, b) => b.at.localeCompare(a.at));
  const groups = new Map<string, TimelineItem[]>();
  for (const item of sorted) {
    const label = dayLabel(new Date(item.at));
    const bucket = groups.get(label);
    if (bucket) bucket.push(item);
    else groups.set(label, [item]);
  }
  return [...groups.entries()];
}

function dayLabel(d: Date): string {
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' });
}
