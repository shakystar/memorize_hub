import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { TaskEntry, TaskStatus } from '@/lib/domain';
import { computeSegments, linearScale, timeDomain, topoOrder } from '@/lib/tasks-timeline';

/**
 * The Tasks workflow timeline: a hand-rolled SVG Gantt. X = real time; one row
 * per task; a segmented bar (wait = todo, work = in_progress); dependsOn drawn
 * as arrows whose head lands at the successor's `startedAt ?? createdAt` (the
 * point where actual work is/was gated). Read-only, theme-aware (currentColor).
 */

const ROW_H = 34;
const BAR_H = 14;
const LABEL_W = 180;
const PAD_X = 16;
const PAD_TOP = 28; // room for the time axis
const CHART_W = 720; // logical width; SVG scales responsively via viewBox

const STATUS_CLASS: Record<TaskStatus, string> = {
  todo: 'text-muted-foreground',
  in_progress: 'text-primary',
  handoff_ready: 'text-primary',
  blocked: 'text-destructive',
  done: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
};

export function TasksTimeline({
  tasks,
  onSelect,
}: {
  tasks: TaskEntry[];
  onSelect: (id: string) => void;
}) {
  const now = Date.now();
  const ordered = useMemo(() => topoOrder(tasks), [tasks]);
  const [lo, hi] = useMemo(() => timeDomain(tasks, now), [tasks, now]);
  const x = useMemo(() => linearScale([lo, hi], [LABEL_W + PAD_X, CHART_W - PAD_X]), [lo, hi]);

  const rowY = (i: number) => PAD_TOP + i * ROW_H + ROW_H / 2;
  const barY = (i: number) => rowY(i) - BAR_H / 2;
  const height = PAD_TOP + ordered.length * ROW_H + 8;

  const index = new Map(ordered.map((t, i) => [t.id, i]));
  const byId = new Map(ordered.map((t) => [t.id, t]));
  const ticks = axisTicks(lo, hi);

  return (
    <div className="mx-auto w-full max-w-4xl overflow-x-auto px-6 pb-4 pt-4">
      <svg
        viewBox={`0 0 ${CHART_W} ${height}`}
        width="100%"
        role="img"
        aria-label="Tasks workflow timeline"
        className="min-w-[640px] text-foreground"
      >
        <defs>
          <marker id="dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" className="text-border" />
          </marker>
        </defs>

        {/* time axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={PAD_TOP - 6} x2={x(t)} y2={height} className="stroke-border" strokeWidth={1} />
            <text x={x(t)} y={PAD_TOP - 12} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {axisLabel(t, hi - lo)}
            </text>
          </g>
        ))}

        {/* dependency arrows: predecessor bar-end -> successor arrowAnchor */}
        {ordered.flatMap((t) =>
          (t.dependsOn ?? [])
            .filter((depId) => index.has(depId))
            .map((depId) => {
              const from = byId.get(depId);
              const fromIdx = index.get(depId);
              const toIdx = index.get(t.id);
              if (from === undefined || fromIdx === undefined || toIdx === undefined) return null;
              const fromSeg = computeSegments(from, now);
              const toSeg = computeSegments(t, now);
              const x1 = x(fromSeg.workEnd ?? fromSeg.waitEnd);
              const y1 = rowY(fromIdx);
              const x2 = x(toSeg.arrowAnchor);
              const y2 = rowY(toIdx);
              return (
                <path
                  key={`${depId}->${t.id}`}
                  d={`M${x1},${y1} C${x1 + 24},${y1} ${x2 - 24},${y2} ${x2},${y2}`}
                  className="fill-none stroke-border"
                  strokeWidth={1.5}
                  markerEnd="url(#dep-arrow)"
                />
              );
            }),
        )}

        {/* rows: label + segmented bar */}
        {ordered.map((t, i) => {
          const seg = computeSegments(t, now);
          const waitX = x(seg.waitStart);
          const waitW = Math.max(2, x(seg.waitEnd) - waitX);
          return (
            <g key={t.id} className="cursor-pointer" onClick={() => onSelect(t.id)}>
              <rect x={0} y={barY(i) - (ROW_H - BAR_H) / 2} width={CHART_W} height={ROW_H} className="fill-transparent hover:fill-secondary/40" />
              <text x={PAD_X} y={rowY(i)} dominantBaseline="middle" className={cn('text-xs', STATUS_CLASS[t.status])}>
                {clip(t.title)}
              </text>
              {/* wait segment (dashed/light) */}
              <rect x={waitX} y={barY(i)} width={waitW} height={BAR_H} rx={3}
                className="fill-secondary" />
              {/* work segment (solid, status-colored) */}
              {seg.workStart !== undefined && seg.workEnd !== undefined && (
                <rect x={x(seg.workStart)} y={barY(i)} width={Math.max(2, x(seg.workEnd) - x(seg.workStart))} height={BAR_H} rx={3}
                  className={cn(t.status === 'blocked' ? 'fill-destructive/70' : t.status === 'done' ? 'fill-muted-foreground' : 'fill-primary')} />
              )}
              {/* milestone marker for terminal-without-work */}
              {seg.milestone && (
                <rect x={x(seg.waitEnd) - 5} y={rowY(i) - 5} width={10} height={10}
                  transform={`rotate(45 ${x(seg.waitEnd)} ${rowY(i)})`}
                  className={cn(t.status === 'cancelled' ? 'fill-muted-foreground' : 'fill-primary')} />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function clip(s: string): string {
  return s.length > 26 ? `${s.slice(0, 25)}…` : s;
}

/** 3-5 evenly spaced ticks across the domain. */
function axisTicks(lo: number, hi: number): number[] {
  const n = 4;
  return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
}

/** Hour granularity under ~2 days, else month/day. */
function axisLabel(t: number, span: number): string {
  const d = new Date(t);
  if (span <= 2 * 86_400_000) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
