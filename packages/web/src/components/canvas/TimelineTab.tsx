import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { DomainTimelineItem, TimelineItem } from '@/lib/domain';

/**
 * The workspace timeline — the canvas's primary view, in chat grammar
 * (docs/design/workspace-canvas-features.md §3): my items on the right,
 * other members' on the left with avatar + name, sessions as centered
 * system lines. Chronological (newest at the bottom), day-divided,
 * filterable by member.
 */
export function TimelineTab({
  items,
  meEmail,
  mock,
  emptyState,
}: {
  items: TimelineItem[];
  /** The signed-in member — their items render on the right, unnamed. */
  meEmail: string;
  /** True when the feed is dev-only mock data — always badged, never silent. */
  mock?: boolean;
  emptyState: ReactNode;
}) {
  const [member, setMember] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const members = useMemo(() => [...new Set(items.map((i) => i.member))], [items]);
  const visible = member ? items.filter((i) => i.member === member) : items;
  const days = useMemo(() => groupByDay(visible), [visible]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [visible.length]);

  if (items.length === 0) return <>{emptyState}</>;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-6 py-4">
      <div className="flex flex-wrap items-center gap-1.5 pb-4">
        {mock && (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
            Mock data — dev only
          </span>
        )}
        <MemberChip label="Everyone" active={member === null} onClick={() => setMember(null)} />
        {members.map((m) => (
          <MemberChip
            key={m}
            label={m === meEmail ? 'Me' : shortName(m)}
            active={member === m}
            onClick={() => setMember(m)}
          />
        ))}
      </div>

      {days.map(([label, dayItems]) => (
        <section key={label}>
          <div className="flex items-center gap-3 py-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-3">
            {groupByAuthor(dayItems).map((group, i) =>
              group.kind === 'system' ? (
                <SystemLine key={group.items[0]?.id ?? i} item={group.items[0]} />
              ) : (
                <MessageGroup
                  key={group.items[0]?.id ?? i}
                  items={group.items}
                  mine={group.member === meEmail}
                />
              ),
            )}
          </div>
        </section>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function MemberChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

/** One member's consecutive run of items: avatar + name once, bubbles stacked. */
function MessageGroup({ items, mine }: { items: DomainTimelineItem[]; mine: boolean }) {
  const head = items[0];
  if (!head) return null;
  return (
    <div className={cn('flex gap-2', mine && 'flex-row-reverse')}>
      {!mine && (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xs font-semibold">
          {shortName(head.member)[0]?.toUpperCase() ?? '?'}
        </span>
      )}
      <div className={cn('flex min-w-0 max-w-[85%] flex-col gap-1', mine && 'items-end')}>
        {!mine && <p className="px-1 text-xs text-muted-foreground">{shortName(head.member)}</p>}
        {items.map((item) => (
          <Bubble key={item.id} item={item} mine={mine} />
        ))}
      </div>
    </div>
  );
}

function Bubble({ item, mine }: { item: DomainTimelineItem; mine: boolean }) {
  const { badge, body, muted } = describe(item);
  return (
    <div className={cn('flex items-end gap-1.5', mine && 'flex-row-reverse')}>
      <div
        className={cn(
          'rounded-2xl px-3 py-2',
          mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-tl-md bg-secondary',
        )}
      >
        {badge && (
          <span
            className={cn(
              'mb-1 mr-1.5 inline-block rounded-full border px-1.5 py-px text-[11px]',
              mine ? 'border-primary-foreground/30 text-primary-foreground/80' : 'border-border text-muted-foreground',
            )}
          >
            {badge}
          </span>
        )}
        <span className={cn('break-words text-sm', muted && 'line-through opacity-70')}>{body}</span>
        {provenanceLine(item) && (
          <p className={cn('mt-1 text-[11px]', mine ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
            {provenanceLine(item)}
          </p>
        )}
      </div>
      <Time at={item.at} />
    </div>
  );
}

/**
 * Session lifecycle reads like a chat system message, not a bubble. Real
 * stores end sessions as paused far more often than completed, so all four
 * verbs render.
 */
const SESSION_VERB = {
  'session.started': 'started a session',
  'session.resumed': 'resumed a session',
  'session.paused': 'paused a session',
  'session.completed': 'finished a session',
} as const;

function SystemLine({ item }: { item: DomainTimelineItem }) {
  if (!isSession(item)) return null;
  const source = item.sourceProjectLabel ?? item.sourceProjectId;
  return (
    <p className="text-center text-xs text-muted-foreground">
      {item.agent} {SESSION_VERB[item.type]}
      {source ? ` · ${source}` : ''} · {formatTime(item.at)}
    </p>
  );
}

/** "writer · source" with either half optional — pre-Phase-0 events carry neither. */
function provenanceLine(item: { writer?: string; sourceProjectId?: string; sourceProjectLabel?: string }): string {
  return [item.writer, item.sourceProjectLabel ?? item.sourceProjectId].filter(Boolean).join(' · ');
}

const KIND_LABEL = { decision: 'Decision', rationale: 'Why', progress: 'Progress' } as const;

function describe(item: DomainTimelineItem): { badge?: string; body: string; muted?: boolean } {
  switch (item.type) {
    case 'memory.consolidated':
      return { badge: KIND_LABEL[item.kind], body: item.text };
    case 'memory.retracted':
      return { badge: 'Retracted', body: item.text, muted: true };
    case 'decision.accepted':
      return { badge: 'Decision', body: item.title };
    case 'task.created':
      return { badge: 'New task', body: item.title };
    case 'task.updated':
      return { badge: item.status.replace('_', ' '), body: item.title };
    case 'handoff.created':
      return { badge: 'Handoff', body: item.title };
    case 'session.started':
    case 'session.resumed':
    case 'session.paused':
    case 'session.completed':
      return { body: '' }; // rendered as a SystemLine, never a bubble
  }
}

function Time({ at }: { at: string }) {
  return (
    <time dateTime={at} className="shrink-0 pb-0.5 text-[11px] tabular-nums text-muted-foreground">
      {formatTime(at)}
    </time>
  );
}

function formatTime(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

type AuthorGroup =
  | { kind: 'messages'; member: string; items: DomainTimelineItem[] }
  | { kind: 'system'; items: [DomainTimelineItem] };

function isSession(
  item: DomainTimelineItem,
): item is DomainTimelineItem & { type: keyof typeof SESSION_VERB } {
  return item.type in SESSION_VERB;
}

/** Split a day into chat runs: consecutive same-member bubbles, system lines standalone. */
function groupByAuthor(items: TimelineItem[]): AuthorGroup[] {
  const groups: AuthorGroup[] = [];
  for (const item of items) {
    if (isSession(item)) {
      groups.push({ kind: 'system', items: [item] });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last?.kind === 'messages' && last.member === item.member) last.items.push(item);
    else groups.push({ kind: 'messages', member: item.member, items: [item] });
  }
  return groups;
}

/** Chronological (chat order): oldest day first, newest message at the bottom. */
function groupByDay(items: TimelineItem[]): Array<[string, TimelineItem[]]> {
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at));
  const groups = new Map<string, TimelineItem[]>();
  for (const item of sorted) {
    const label = dayLabel(new Date(item.at));
    const bucket = groups.get(label);
    if (bucket) bucket.push(item);
    else groups.set(label, [item]);
  }
  return [...groups.entries()];
}

function shortName(email: string): string {
  return email.split('@')[0] ?? email;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' });
}
