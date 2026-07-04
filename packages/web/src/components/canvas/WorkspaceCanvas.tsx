import { type ReactNode, useRef } from 'react';

import { ConnectTab } from '@/components/canvas/ConnectTab';
import { TasksTab } from '@/components/canvas/TasksTab';
import { TimelineTab } from '@/components/canvas/TimelineTab';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MOCK_ENABLED, MOCK_TASKS, MOCK_TIMELINE } from '@/lib/mock';
import { getWorkspaceTasks } from '@/lib/api';
import { useLiveFeed } from '@/lib/live-feed';
import { usePaginatedTimeline } from '@/lib/paginated-timeline';
import type { TaskEntry } from '@/lib/domain';
import { TABS, type Tab } from '@/lib/tabs';

/**
 * The workspace main canvas: a tab bar over the memory views
 * (docs/design/workspace-canvas-features.md §3). Launch tabs (Timeline,
 * Tasks) come first; the TBD group stays left-aligned behind a divider as
 * honest "in development" placeholders until the read surface (H060)
 * exists. Example data renders in dev (design review) and in anonymous
 * demo mode (the landing experience) — always badged, never silent.
 */

export function WorkspaceCanvas({
  workspaceId,
  meEmail,
  demo,
  tab,
  onTabChange,
}: {
  workspaceId: string;
  meEmail: string;
  demo?: boolean;
  tab: Tab;
  onTabChange: (t: Tab) => void;
}) {
  const example = MOCK_ENABLED || demo;
  // demo has no Connect tab (its commands target a fake workspace), so even a
  // forced URL entry is treated as timeline to avoid a blank screen.
  const effectiveTab = demo && tab === 'connect' ? 'timeline' : tab;
  const badge = demo ? 'Example data' : MOCK_ENABLED ? 'Mock data - dev only' : undefined;

  // Both surfaces prefetch at mount, in parallel: by the time the Tasks tab is
  // clicked its data has usually arrived, and cached items from an earlier
  // visit render instantly while the refresh runs (stale-while-revalidate).
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeline = usePaginatedTimeline(workspaceId, !example);
  const tasks = useLiveFeed<TaskEntry>(`hub:tasks:${workspaceId}`, !example, () =>
    getWorkspaceTasks(workspaceId).then((result) => result.items),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex items-stretch gap-1 border-b border-border px-6">
        {TABS.map((t, i) => (
          <span key={t.id} className="flex items-stretch gap-1">
            {t.tbd && !TABS[i - 1]?.tbd && <span className="my-2 mx-1 w-px bg-border" />}
            <button
              onClick={() => onTabChange(t.id)}
              className={cn(
                '-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm',
                effectiveTab === t.id
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {t.tbd && (
                <span className="rounded-sm border border-border px-1 text-[10px] text-muted-foreground">
                  TBD
                </span>
              )}
            </button>
          </span>
        ))}
        {!demo && (
          <button
            onClick={() => onTabChange('connect')}
            className={cn(
              '-mb-px ml-auto flex items-center border-b-2 px-3 py-2 text-sm',
              effectiveTab === 'connect'
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            Connect
          </button>
        )}
      </nav>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {effectiveTab === 'connect' && !demo && <ConnectTab workspaceId={workspaceId} />}
        {effectiveTab === 'timeline' && (
          <TimelineTab
            items={example ? MOCK_TIMELINE : timeline.items}
            meEmail={meEmail}
            badge={badge}
            hasMore={example ? false : timeline.hasMore}
            loadingOlder={example ? false : timeline.loadingOlder}
            onLoadOlder={example ? () => {} : timeline.loadOlder}
            scrollParentRef={scrollRef}
            emptyState={
              !example && timeline.loading ? (
                <TimelineStatus title="Loading timeline" />
              ) : !example && timeline.error ? (
                <TimelineStatus title="Timeline unavailable" detail={timeline.error} />
              ) : (
                <TimelineEmptyState onConnect={() => onTabChange('connect')} />
              )
            }
          />
        )}
        {effectiveTab === 'talk' && (
          <ComingSoon title="Talk">
            Talk to this workspace&apos;s agents. A message you write here becomes an event in
            the shared log; each member&apos;s agent pulls it on its next sync and picks it up
            at session start. No server-side AI — replies come from your own machines.
            Leave-a-message first, realtime later.
          </ComingSoon>
        )}
        {effectiveTab === 'tasks' && (
          <TasksTab
            tasks={example ? MOCK_TASKS : tasks.items}
            badge={badge}
            emptyState={
              !example && tasks.loading ? (
                <TimelineStatus title="Loading tasks" />
              ) : !example && tasks.error ? (
                <TimelineStatus title="Tasks unavailable" detail={tasks.error} />
              ) : (
                <TasksEmptyState />
              )
            }
          />
        )}
        {effectiveTab === 'decisions' && (
          <ComingSoon title="Decisions">
            The decision log — every accepted decision with its history, including what it replaced.
          </ComingSoon>
        )}
        {effectiveTab === 'sources' && (
          <ComingSoon title="Sources">
            The files behind the memories. When a memory says &ldquo;see the pricing doc&rdquo;, the
            doc itself lives here — uploaded once, then fetchable on demand by any member or their
            agent, from any machine.
          </ComingSoon>
        )}
      </div>
    </div>
  );
}

/**
 * The live (non-mock) timeline is empty until the sync-activity feed lands, so
 * the empty state points at the onboarding path: connect a machine, watch the
 * first sync arrive here.
 */
function TimelineEmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="max-w-md rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">Nothing here yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Activity shows up here when a machine syncs into this workspace. Browsing and querying
          the memory itself arrives with the read surface (a separate headless memorize replica).
        </p>
        <Button size="sm" className="mt-4" onClick={onConnect}>
          Connect a machine
        </Button>
      </div>
    </div>
  );
}

function TasksEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="max-w-md rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">No tasks yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Tasks and handoffs land here when an agent claims work on a connected machine
          (<code className="rounded bg-secondary px-1">memorize task create</code>) and syncs.
        </p>
      </div>
    </div>
  );
}

function TimelineStatus({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="max-w-md rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="mt-2 text-sm text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{children}</p>
        <p className="mt-3 inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          개발 예정
        </p>
      </div>
    </div>
  );
}
