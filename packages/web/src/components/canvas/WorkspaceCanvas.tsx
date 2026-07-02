import { type ReactNode, useState } from 'react';

import { KnowledgeTab } from '@/components/canvas/KnowledgeTab';
import { TimelineTab } from '@/components/canvas/TimelineTab';
import { cn } from '@/lib/utils';
import { MOCK_ENABLED, MOCK_KNOWLEDGE, MOCK_TIMELINE } from '@/lib/mock';

/**
 * The workspace main canvas: a tab bar over the memory views
 * (docs/design/workspace-canvas-features.md §3). Timeline is the primary
 * axis; the other tabs are [replica]-layer and stay honest "in development"
 * placeholders until the read surface (H060) exists. In dev the timeline
 * renders badged mock data so the design can be reviewed now.
 */

type Tab = 'timeline' | 'knowledge' | 'tasks' | 'decisions';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'decisions', label: 'Decisions' },
];

function initialTab(): Tab {
  const wanted = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((t) => t.id === wanted) ? (wanted as Tab) : 'timeline';
}

export function WorkspaceCanvas({ meEmail }: { meEmail: string }) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex gap-1 border-b border-border px-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === t.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'timeline' && (
          <TimelineTab
            items={MOCK_ENABLED ? MOCK_TIMELINE : []}
            meEmail={meEmail}
            mock={MOCK_ENABLED}
            emptyState={<TimelineEmptyState />}
          />
        )}
        {tab === 'knowledge' && (
          <KnowledgeTab
            entries={MOCK_ENABLED ? MOCK_KNOWLEDGE : []}
            mock={MOCK_ENABLED}
            emptyState={
              <ComingSoon title="Knowledge">
                Everything this workspace has learned, as a living document — decisions, the why
                behind them, and progress, grouped by topic and sorted by importance.
              </ComingSoon>
            }
          />
        )}
        {tab === 'tasks' && (
          <ComingSoon title="Tasks">
            The workspace&apos;s tasks and handoffs — what agents are working on, what is ready to
            hand over, and what got done.
          </ComingSoon>
        )}
        {tab === 'decisions' && (
          <ComingSoon title="Decisions">
            The decision log — every accepted decision with its history, including what it replaced.
          </ComingSoon>
        )}
      </div>
    </div>
  );
}

/**
 * The live (non-mock) timeline is empty until the sync-activity feed lands, so
 * the empty state is the onboarding path: connect an agent, watch the first
 * sync arrive here.
 */
function TimelineEmptyState() {
  const origin = window.location.origin;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="max-w-md rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">Nothing here yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Activity shows up here when a machine syncs into this workspace. Browsing and querying
          the memory itself arrives with the read surface (a separate headless memorize replica).
        </p>
        <p className="mt-3 inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          개발 예정
        </p>
      </div>
      <div className="w-full max-w-xl">
        <p className="text-xs text-muted-foreground">
          Sync a local folder into this workspace (needs a key from your account, memorize 2.5.0+):
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-card px-3 py-2 text-xs font-mono">
          memorize auth login --remote-url {origin} --token YOUR_KEY
        </pre>
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
