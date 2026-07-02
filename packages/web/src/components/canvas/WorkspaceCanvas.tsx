import { type ReactNode, useEffect, useState } from 'react';

import { ConnectTab } from '@/components/canvas/ConnectTab';
import { TasksTab } from '@/components/canvas/TasksTab';
import { TimelineTab } from '@/components/canvas/TimelineTab';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MOCK_ENABLED, MOCK_TASKS, MOCK_TIMELINE } from '@/lib/mock';
import { getWorkspaceTimeline } from '@/lib/api';
import type { TimelineItem } from '@/lib/domain';

/**
 * The workspace main canvas: a tab bar over the memory views
 * (docs/design/workspace-canvas-features.md §3). Launch tabs (Timeline,
 * Tasks) come first; the TBD group stays left-aligned behind a divider as
 * honest "in development" placeholders until the read surface (H060)
 * exists. Example data renders in dev (design review) and in anonymous
 * demo mode (the landing experience) — always badged, never silent.
 */

type Tab = 'timeline' | 'tasks' | 'talk' | 'decisions' | 'sources' | 'connect';

const TABS: Array<{ id: Tab; label: string; tbd?: boolean }> = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'talk', label: 'Talk', tbd: true },
  { id: 'decisions', label: 'Decisions', tbd: true },
  { id: 'sources', label: 'Sources', tbd: true },
];

/**
 * Timeline is the primary workspace landing, including the live product. `?tab=`
 * still wins (Connect excluded in demo - the commands would target a fake
 * workspace), and an empty live Timeline points users to Connect.
 */
function initialTab(demo: boolean): Tab {
  const wanted = new URLSearchParams(window.location.search).get('tab');
  if (wanted === 'connect') return demo ? 'timeline' : 'connect';
  if (TABS.some((t) => t.id === wanted)) return wanted as Tab;
  return 'timeline';
}

export function WorkspaceCanvas({
  workspaceId,
  meEmail,
  demo,
}: {
  workspaceId: string;
  meEmail: string;
  demo?: boolean;
}) {
  const example = MOCK_ENABLED || demo;
  const [tab, setTab] = useState<Tab>(() => initialTab(Boolean(demo)));
  const [timeline, setTimeline] = useState<{
    items: TimelineItem[];
    loading: boolean;
    error?: string;
  }>({ items: [], loading: false });
  const badge = demo ? 'Example data' : MOCK_ENABLED ? 'Mock data - dev only' : undefined;

  useEffect(() => {
    if (example) {
      setTimeline({ items: [], loading: false });
      return;
    }
    let cancelled = false;
    setTimeline((current) => ({ items: current.items, loading: true }));
    getWorkspaceTimeline(workspaceId)
      .then((result) => {
        if (!cancelled) setTimeline({ items: result.items, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTimeline({
            items: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [example, workspaceId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex items-stretch gap-1 border-b border-border px-6">
        {TABS.map((t, i) => (
          <span key={t.id} className="flex items-stretch gap-1">
            {t.tbd && !TABS[i - 1]?.tbd && <span className="my-2 mx-1 w-px bg-border" />}
            <button
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm',
                tab === t.id
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
            onClick={() => setTab('connect')}
            className={cn(
              '-mb-px ml-auto flex items-center border-b-2 px-3 py-2 text-sm',
              tab === 'connect'
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            Connect
          </button>
        )}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'connect' && !demo && <ConnectTab workspaceId={workspaceId} />}
        {tab === 'timeline' && (
          <TimelineTab
            items={example ? MOCK_TIMELINE : timeline.items}
            meEmail={meEmail}
            badge={badge}
            emptyState={
              !example && timeline.loading ? (
                <TimelineStatus title="Loading timeline" />
              ) : !example && timeline.error ? (
                <TimelineStatus title="Timeline unavailable" detail={timeline.error} />
              ) : (
                <TimelineEmptyState onConnect={() => setTab('connect')} />
              )
            }
          />
        )}
        {tab === 'talk' && (
          <ComingSoon title="Talk">
            Talk to this workspace&apos;s agents. A message you write here becomes an event in
            the shared log; each member&apos;s agent pulls it on its next sync and picks it up
            at session start. No server-side AI — replies come from your own machines.
            Leave-a-message first, realtime later.
          </ComingSoon>
        )}
        {tab === 'tasks' && (
          <TasksTab
            tasks={example ? MOCK_TASKS : []}
            badge={badge}
            emptyState={
              <ComingSoon title="Tasks">
                The workspace&apos;s tasks and handoffs — what agents are working on, what is ready
                to hand over, and what got done.
              </ComingSoon>
            }
          />
        )}
        {tab === 'decisions' && (
          <ComingSoon title="Decisions">
            The decision log — every accepted decision with its history, including what it replaced.
          </ComingSoon>
        )}
        {tab === 'sources' && (
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
