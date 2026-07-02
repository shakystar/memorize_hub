import { History, Undo2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { ConsolidatedMemoryKind, KnowledgeEntry } from '@/lib/domain';

/**
 * The knowledge tab — the workspace's consolidated memory as a living
 * document (docs/design/workspace-canvas-features.md §3): sections by kind,
 * salience-sorted, tag-filterable. Superseded/retracted entries are closed,
 * not deleted, so they stay reachable behind a toggle.
 */
export function KnowledgeTab({
  entries,
  mock,
  emptyState,
}: {
  entries: KnowledgeEntry[];
  /** True when dev-only mock data — always badged, never silent. */
  mock?: boolean;
  emptyState: ReactNode;
}) {
  const [tag, setTag] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const tags = useMemo(
    () => [...new Set(entries.flatMap((e) => e.tags ?? []))].sort(),
    [entries],
  );
  const closedCount = entries.filter(isClosed).length;
  const visible = entries
    .filter((e) => (tag ? (e.tags ?? []).includes(tag) : true))
    .filter((e) => showClosed || !isClosed(e));

  if (entries.length === 0) return <>{emptyState}</>;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-4">
      <div className="flex flex-wrap items-center gap-1.5 pb-4">
        {mock && (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
            Mock data — dev only
          </span>
        )}
        <FilterChip label="All" active={tag === null} onClick={() => setTag(null)} />
        {tags.map((t) => (
          <FilterChip key={t} label={`#${t}`} active={tag === t} onClick={() => setTag(t)} />
        ))}
        {closedCount > 0 && (
          <button
            onClick={() => setShowClosed((v) => !v)}
            className={cn(
              'ml-auto flex items-center gap-1 text-xs',
              showClosed ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <History className="size-3.5" />
            {showClosed ? 'Hide history' : `History (${closedCount})`}
          </button>
        )}
      </div>

      {KIND_ORDER.map((kind) => {
        const section = visible
          .filter((e) => e.kind === kind)
          .sort((a, b) => b.salience - a.salience || b.at.localeCompare(a.at));
        if (section.length === 0) return null;
        return (
          <section key={kind} className="mb-6">
            <h2 className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {KIND_HEADING[kind]} ({section.length})
            </h2>
            <ul className="space-y-2">
              {section.map((e) => (
                <EntryCard key={e.id} entry={e} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const KIND_ORDER: ConsolidatedMemoryKind[] = ['decision', 'rationale', 'progress'];
const KIND_HEADING: Record<ConsolidatedMemoryKind, string> = {
  decision: 'Decisions',
  rationale: 'Why',
  progress: 'Progress',
};

function isClosed(e: KnowledgeEntry): boolean {
  return Boolean(e.superseded || e.retracted);
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

function EntryCard({ entry }: { entry: KnowledgeEntry }) {
  const closed = isClosed(entry);
  return (
    <li
      className={cn(
        'rounded-lg border border-border bg-card px-4 py-3',
        closed && 'border-dashed opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <p className={cn('min-w-0 flex-1 text-sm', closed && 'line-through')}>{entry.text}</p>
        <Salience value={entry.salience} />
      </div>
      {entry.superseded && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="size-3.5 shrink-0" />
          Superseded{entry.superseded.note ? ` — ${entry.superseded.note}` : ''}
        </p>
      )}
      {entry.retracted && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Undo2 className="size-3.5 shrink-0" />
          Retracted
        </p>
      )}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {(entry.tags ?? []).map((t) => (
          <span key={t} className="rounded-full border border-border px-1.5 py-px text-[11px]">
            #{t}
          </span>
        ))}
        <span>
          {shortName(entry.member)} · {entry.writer} · {entry.sourceProjectLabel ?? entry.sourceProjectId}
        </span>
        <time dateTime={entry.at} className="ml-auto tabular-nums">
          {new Date(entry.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </time>
      </p>
    </li>
  );
}

/** Salience 1-10 as a compact meter: a filled bar plus the number. */
function Salience({ value }: { value: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={`Salience ${value}/10`}>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full bg-primary" style={{ width: `${value * 10}%` }} />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
    </span>
  );
}

function shortName(email: string): string {
  return email.split('@')[0] ?? email;
}
