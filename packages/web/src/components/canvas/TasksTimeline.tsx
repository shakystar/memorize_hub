import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { Priority, TaskEntry, TaskStatus } from '@/lib/domain';
import { computeSegments, timeDomain, topoOrder } from '@/lib/tasks-timeline';

/**
 * The Tasks workflow timeline — a Notion-style Gantt. Each task is a segmented
 * bar drawn at TRUE time scale (fixed px/day): an outlined WAIT track
 * (createdAt → startedAt) then a solid, status-coloured WORK segment
 * (startedAt → end). The title is NOT boxed inside the bar — it floats just to
 * the right, spilling into empty space, so the bar stays time-accurate and the
 * wait|work boundary lines up with the axis and with incoming dependency arrows
 * (which land at `startedAt ?? createdAt`). Arrows are drawn on top of the bars.
 * The strip scroll-pans through time on the wheel / trackpad (scrollbar hidden),
 * and the time window extends both directions as you reach an edge. Read-only.
 */

const DAY = 86_400_000;
const PX_PER_DAY = 140;
const HEADER_H = 44;
const ROW_H = 40;
const BAR_H = 14;

const INITIAL_BEFORE = 15 * DAY;
const INITIAL_AFTER = 45 * DAY;
const CHUNK = 30 * DAY; // time grafted on when a scroll edge is reached
const EDGE_PX = 400; // proximity to an edge that triggers a graft

/** Solid status colour for the work segment / milestone. */
function statusBg(status: TaskStatus): string {
  if (status === 'blocked') return 'bg-destructive';
  if (status === 'done') return 'bg-muted-foreground';
  if (status === 'handoff_ready') return 'bg-primary/70';
  if (status === 'in_progress') return 'bg-primary';
  return 'bg-muted-foreground/40'; // todo
}

const PRIORITY_CHIP: Record<Priority, string> = {
  high: 'bg-destructive/15 text-destructive',
  medium: 'bg-primary/15 text-primary',
  low: 'bg-muted text-muted-foreground',
};
const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Med', low: 'Low' };

export function TasksTimeline({
  tasks,
  onSelect,
}: {
  tasks: TaskEntry[];
  onSelect: (id: string) => void;
}) {
  const now = Date.now();
  const ordered = useMemo(() => topoOrder(tasks), [tasks]);
  const [dataLo, dataHi] = useMemo(() => timeDomain(tasks, now), [tasks, now]);

  const [win, setWin] = useState(() => ({
    lo: Math.min(dataLo, now) - INITIAL_BEFORE,
    hi: Math.max(dataHi, now) + INITIAL_AFTER,
  }));

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLo = useRef(win.lo);
  const didInit = useRef(false);

  const xOf = (t: number) => ((t - win.lo) / DAY) * PX_PER_DAY;
  const totalW = ((win.hi - win.lo) / DAY) * PX_PER_DAY;
  const totalH = HEADER_H + ordered.length * ROW_H + 12;

  const index = new Map(ordered.map((t, i) => [t.id, i]));
  const byId = new Map(ordered.map((t) => [t.id, t]));
  const ticks = useMemo(() => dayTicks(win.lo, win.hi, now), [win.lo, win.hi, now]);

  // Wheel / trackpad → horizontal pan. Native listener so we can preventDefault
  // (React's onWheel is passive and cannot stop the page from scrolling).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Centre the initial view roughly on "now".
  useLayoutEffect(() => {
    if (didInit.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = xOf(now) - el.clientWidth * 0.35;
    didInit.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grafting time onto the left shifts every x by the same amount — bump
  // scrollLeft by that delta so the view does not jump.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevLo.current !== win.lo) {
      const deltaDays = (prevLo.current - win.lo) / DAY;
      if (deltaDays > 0) el.scrollLeft += deltaDays * PX_PER_DAY;
      prevLo.current = win.lo;
    }
  }, [win.lo]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollLeft < EDGE_PX) {
      setWin((w) => ({ lo: w.lo - CHUNK, hi: w.hi }));
    } else if (el.scrollLeft > el.scrollWidth - el.clientWidth - EDGE_PX) {
      setWin((w) => ({ lo: w.lo, hi: w.hi + CHUNK }));
    }
  };

  const goToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: xOf(now) - el.clientWidth * 0.35, behavior: 'smooth' });
  };

  return (
    <div className="px-6 pb-4 pt-4">
      <div className="mb-2 flex justify-end">
        <button
          onClick={goToday}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Today
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative overflow-x-auto overflow-y-hidden rounded-lg border border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: totalH }}
      >
        <div className="relative" style={{ width: totalW, height: totalH }}>
          {/* back layer: day gridlines + today line */}
          <svg className="absolute inset-0" width={totalW} height={totalH}>
            {ticks.map((tk) => (
              <line
                key={tk.t}
                x1={xOf(tk.t)}
                y1={HEADER_H - 6}
                x2={xOf(tk.t)}
                y2={totalH}
                className={tk.isToday ? 'stroke-destructive/60' : 'stroke-border'}
                strokeWidth={1}
              />
            ))}
          </svg>

          {/* date axis */}
          {ticks.map((tk) => (
            <div
              key={tk.t}
              className="absolute top-1.5 flex flex-col"
              style={{ left: xOf(tk.t) + 4 }}
            >
              {tk.monthLabel && (
                <span className="text-[10px] font-medium text-foreground">{tk.monthLabel}</span>
              )}
              <span
                className={cn(
                  'text-[10px]',
                  tk.isToday
                    ? 'flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground'
                    : 'text-muted-foreground',
                  !tk.monthLabel && 'mt-3.5',
                )}
              >
                {tk.day}
              </span>
            </div>
          ))}

          {/* rows: true-scale segmented bar + floating title to the right */}
          {ordered.map((t, i) => {
            const seg = computeSegments(t, now);
            const end = seg.workEnd ?? seg.waitEnd;
            const top = HEADER_H + i * ROW_H;
            const cy = top + ROW_H / 2;
            const barTop = cy - BAR_H / 2;
            const waitL = xOf(seg.waitStart);
            const waitW = Math.max(2, xOf(seg.waitEnd) - waitL);
            return (
              <Fragment key={t.id}>
                {/* full-row click / hover strip (behind the bar) */}
                <button
                  onClick={() => onSelect(t.id)}
                  title={t.title}
                  aria-label={t.title}
                  className="absolute left-0 rounded-sm hover:bg-secondary/30"
                  style={{ top, height: ROW_H, width: totalW }}
                />
                {/* wait track (createdAt -> startedAt/end): outlined so it reads on dark */}
                <span
                  className="pointer-events-none absolute rounded-sm border border-border bg-accent"
                  style={{ left: waitL, top: barTop, width: waitW, height: BAR_H }}
                />
                {/* work segment (startedAt -> end): solid status colour */}
                {seg.workStart !== undefined && seg.workEnd !== undefined && (
                  <span
                    className={cn('pointer-events-none absolute rounded-sm', statusBg(t.status))}
                    style={{
                      left: xOf(seg.workStart),
                      top: barTop,
                      width: Math.max(2, xOf(seg.workEnd) - xOf(seg.workStart)),
                      height: BAR_H,
                    }}
                  />
                )}
                {/* milestone (terminal, never started): diamond at the end */}
                {seg.milestone && (
                  <span
                    className={cn(
                      'pointer-events-none absolute rotate-45 rounded-[2px]',
                      statusBg(t.status),
                    )}
                    style={{ left: xOf(seg.waitEnd) - 5, top: cy - 5, width: 10, height: 10 }}
                  />
                )}
                {/* floating title + priority, just past the bar's end */}
                <div
                  className="pointer-events-none absolute flex items-center gap-1.5 whitespace-nowrap"
                  style={{ left: xOf(end) + 8, top: cy - 9 }}
                >
                  <span
                    className={cn(
                      'text-xs text-foreground',
                      t.status === 'cancelled' && 'text-muted-foreground line-through',
                    )}
                  >
                    {t.title}
                  </span>
                  <span className={cn('rounded px-1 text-[10px]', PRIORITY_CHIP[t.priority])}>
                    {PRIORITY_LABEL[t.priority]}
                  </span>
                </div>
              </Fragment>
            );
          })}

          {/* front layer: dependency arrows (on top so they are never buried) */}
          <svg className="pointer-events-none absolute inset-0" width={totalW} height={totalH}>
            <defs>
              <marker
                id="dep-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="#d99a4e" />
              </marker>
            </defs>
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
                  const x1 = xOf(fromSeg.workEnd ?? fromSeg.waitEnd);
                  const y1 = HEADER_H + fromIdx * ROW_H + ROW_H / 2;
                  const x2 = xOf(toSeg.arrowAnchor);
                  const y2 = HEADER_H + toIdx * ROW_H + ROW_H / 2;
                  return (
                    <path
                      key={`${depId}->${t.id}`}
                      d={`M${x1},${y1} C${x1 + 28},${y1} ${x2 - 28},${y2} ${x2},${y2}`}
                      fill="none"
                      stroke="#d99a4e"
                      strokeWidth={1.5}
                      markerEnd="url(#dep-arrow)"
                    />
                  );
                }),
            )}
          </svg>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        휠·트랙패드로 좌우 이동(양방향 무제한) · 막대: 윤곽=대기, 채움=작업(상태색) · 제목은 막대 오른쪽 · 화살표=선후행
      </p>
    </div>
  );
}

interface Tick {
  t: number;
  day: number;
  isToday: boolean;
  monthLabel?: string;
}

/** One tick per calendar day across [lo, hi]; month name on the 1st (and the first tick). */
function dayTicks(lo: number, hi: number, now: number): Tick[] {
  const start = new Date(lo);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const ticks: Tick[] = [];
  for (let ms = start.getTime(); ms <= hi; ms += DAY) {
    if (ms < lo) continue;
    const d = new Date(ms);
    ticks.push({
      t: ms,
      day: d.getDate(),
      isToday: d.getTime() === today.getTime(),
      ...(d.getDate() === 1 || ticks.length === 0
        ? { monthLabel: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) }
        : {}),
    });
  }
  return ticks;
}
