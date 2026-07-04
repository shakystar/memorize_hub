import { BookText, BrainCircuit, Github, Plus, Settings } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { AccountSettings } from '@/components/AccountSettings';
import { WorkspaceCanvas } from '@/components/canvas/WorkspaceCanvas';
import { NewWorkspaceDialog } from '@/components/NewWorkspaceDialog';
import { SharePopover } from '@/components/SharePopover';
import { WorkspaceSettings } from '@/components/WorkspaceSettings';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getMe, listWorkspaces, type Me, type Workspace } from '@/lib/api';
import { MOCK_ENABLED, MOCK_ME, MOCK_WORKSPACES } from '@/lib/mock';
import { useAppLocation } from '@/lib/use-app-location';
import type { Tab } from '@/lib/tabs';

function Sidebar({
  me,
  demo,
  workspaces,
  selectedId,
  view,
  onSelect,
  onSelectPersonal,
  onCreate,
  onOpenAccount,
}: {
  me: Me;
  /** Anonymous demo: example data, no account — the bottom slot becomes Sign in. */
  demo?: boolean;
  workspaces: Workspace[];
  selectedId: string | null;
  view: 'workspace' | 'personal';
  onSelect: (id: string) => void;
  onSelectPersonal: () => void;
  onCreate: () => void;
  onOpenAccount: () => void;
}) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="font-semibold">
          Memorize <span className="text-muted-foreground">Hub</span>
        </span>
      </div>

      <nav className="px-2">
        <SidebarLink icon={<BookText />} label="Docs" href="/docs" />
        <SidebarLink icon={<Github />} label="GitHub" href="https://github.com/shakystar/memorize" />
      </nav>

      <div className="mx-2 my-2 border-t border-border" />
      <nav className="px-2">
        <button
          onClick={onSelectPersonal}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
            view === 'personal'
              ? 'bg-secondary font-medium text-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          <BrainCircuit className="size-4" /> Personal memory
        </button>
      </nav>

      <div className="mx-2 my-2 border-t border-border" />

      <div className="flex items-center justify-between px-4 py-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Workspaces
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" title="New workspace" onClick={onCreate}>
          <Plus />
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        {workspaces.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No workspaces yet.</p>
        ) : (
          workspaces.map((w) => (
            <button
              key={w.workspaceId}
              onClick={() => onSelect(w.workspaceId)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm',
                view === 'workspace' && w.workspaceId === selectedId
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <span className="truncate">
                <span className="text-muted-foreground">#</span> {w.name ?? 'untitled'}
              </span>
              <span className="text-xs text-muted-foreground">{w.memberCount}</span>
            </button>
          ))
        )}
      </nav>

      <div className="border-t border-border p-2">
        {demo ? (
          <a href="/account/login" className="block hover:no-underline">
            <Button className="w-full">Sign in</Button>
          </a>
        ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-secondary">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xs font-semibold">
                {(me.email[0] ?? '?').toUpperCase()}
              </span>
              <span className="truncate">{me.email}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuLabel>
              <div className="truncate text-sm font-medium">{me.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenAccount}>Account settings</DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="/docs" className="hover:no-underline">
                Docs
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/account/logout" className="text-destructive hover:no-underline">
                Sign out
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>
    </aside>
  );
}

function SidebarLink({ icon, label, href }: { icon: ReactNode; label: string; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground hover:no-underline"
    >
      <span className="[&_svg]:size-4">{icon}</span>
      {label}
    </a>
  );
}

function WorkspaceView({
  me,
  demo,
  workspace,
  onOpenSettings,
  onChanged,
  tab,
  onTabChange,
}: {
  me: Me;
  /** Anonymous demo: Example chip + a sign-in CTA instead of share/settings. */
  demo?: boolean;
  workspace: Workspace;
  onOpenSettings: () => void;
  onChanged: (opts?: { removed?: boolean }) => void;
  tab: Tab;
  onTabChange: (t: Tab) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">{workspace.name ?? 'untitled'}</h1>
          <span className="text-xs text-muted-foreground">
            {workspace.inviteReachable ? 'shared' : 'private'}
          </span>
          {demo && (
            <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
              Example
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {demo ? (
            <a href="/account/login" className="hover:no-underline">
              <Button size="sm">Sign in to build your own</Button>
            </a>
          ) : (
            <>
              <SharePopover me={me} workspaceId={workspace.workspaceId} onChanged={onChanged} />
              {workspace.role === 'owner' && (
                <Button variant="ghost" size="icon" onClick={onOpenSettings} title="Workspace settings">
                  <Settings />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <WorkspaceCanvas
        workspaceId={workspace.workspaceId}
        meEmail={me.email}
        demo={demo}
        tab={tab}
        onTabChange={onTabChange}
      />
    </div>
  );
}

function PersonalMemoryView({ me, demo }: { me: Me; demo?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-lg font-semibold">Personal memory</h1>
        <span className="text-xs text-muted-foreground">private · account-scoped</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="max-w-md rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">Your personal memory</p>
          <p className="mt-2 text-sm text-muted-foreground">
            A private, cross-project store that follows you across machines. Browsing and querying it
            arrives with the read surface (a separate headless memorize replica). Reserved here.
          </p>
          <p className="mt-3 inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            개발 예정
          </p>
        </div>
        {demo ? (
          <a href="/account/login" className="hover:no-underline">
            <Button size="sm">Sign in to get yours</Button>
          </a>
        ) : (
          <div className="w-full max-w-xl">
            <p className="text-xs text-muted-foreground">Personal store id</p>
            <code className="mt-1 block font-mono text-sm">{me.personalStoreId}</code>
          </div>
        )}
      </div>
    </div>
  );
}

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">{children}</div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { route, navigate } = useAppLocation();
  const view = route.view;
  const currentTab = route.view === 'workspace' ? route.tab : 'timeline';

  const refreshWorkspaces = useCallback(async () => {
    const ws = await listWorkspaces();
    setWorkspaces(ws);
    return ws;
  }, []);

  const load = useCallback(async () => {
    // `?demo` forces the anonymous example view even when signed in — a
    // stable link for "see it in action" from docs/marketing.
    if (new URLSearchParams(window.location.search).has('demo')) {
      setMe(null);
      return;
    }
    try {
      const m = await getMe();
      setMe(m);
      if (m) {
        await refreshWorkspaces();
      }
    } catch (err) {
      // Dev without a running gateway: fall back to mock identity so the
      // canvas can be designed against mock data. Never happens in a build.
      if (!MOCK_ENABLED) throw err;
      setMe(MOCK_ME);
      setWorkspaces(MOCK_WORKSPACES);
    }
  }, [refreshWorkspaces]);

  useEffect(() => {
    void load();
  }, [load]);

  // No session -> anonymous demo instead of a login wall: the app shell with
  // a badged example workspace, and Sign in where the account chrome was.
  // Computed above the loading early-return since the reconciliation effect
  // below (a hook) needs shownWorkspaces and hooks can't follow a return.
  const demo = me === null;
  const shownWorkspaces = demo ? MOCK_WORKSPACES : workspaces;

  // Reconcile the URL against the actual workspace list after load: an empty
  // /app or an id no longer in the list (left/deleted/no-access) gets replaced
  // with the first workspace. There is no error page.
  useEffect(() => {
    if (me === undefined) return; // still loading (the Loading… card is up)
    if (route.view !== 'workspace') return;
    const first = shownWorkspaces[0];
    if (!first) return; // "No workspace selected" empty state
    const exists =
      route.workspaceId != null &&
      shownWorkspaces.some((w) => w.workspaceId === route.workspaceId);
    if (!exists) {
      navigate(
        { view: 'workspace', workspaceId: first.workspaceId, tab: route.tab },
        { replace: true },
      );
    }
  }, [me, shownWorkspaces, route, navigate]);

  if (me === undefined) {
    return <CenteredCard>
      <p className="text-sm text-muted-foreground">Loading…</p>
    </CenteredCard>;
  }

  const account = me ?? MOCK_ME;
  const routeWorkspaceId = route.view === 'workspace' ? route.workspaceId : null;
  const selected =
    shownWorkspaces.find((w) => w.workspaceId === routeWorkspaceId) ??
    (demo ? (shownWorkspaces[0] ?? null) : null);
  const onChanged = async (opts?: { removed?: boolean }) => {
    const ws = await refreshWorkspaces();
    if (opts?.removed) {
      navigate(
        { view: 'workspace', workspaceId: ws[0]?.workspaceId ?? null, tab: 'timeline' },
        { replace: true },
      );
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        me={account}
        demo={demo}
        workspaces={shownWorkspaces}
        selectedId={selected?.workspaceId ?? null}
        view={view}
        onSelect={(id) =>
          navigate({ view: 'workspace', workspaceId: id, tab: currentTab })
        }
        onSelectPersonal={() => navigate({ view: 'personal' })}
        onCreate={() => (demo ? (window.location.href = '/account/login') : setNewOpen(true))}
        onOpenAccount={() => setAccountOpen(true)}
      />
      <main className="min-w-0 flex-1">
        {view === 'personal' ? (
          <PersonalMemoryView me={account} demo={demo} />
        ) : selected ? (
          <WorkspaceView
            me={account}
            demo={demo}
            workspace={selected}
            onOpenSettings={() => setSettingsOpen(true)}
            onChanged={onChanged}
            tab={currentTab}
            onTabChange={(t) =>
              navigate({ view: 'workspace', workspaceId: selected.workspaceId, tab: t })
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm font-medium">No workspace selected</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a workspace to get started. A workspace with one member is a private project.
              </p>
              <Button className="mt-4" onClick={() => setNewOpen(true)}>
                <Plus /> New workspace
              </Button>
            </div>
          </div>
        )}
      </main>

      {!demo && (
        <>
          <NewWorkspaceDialog
            open={newOpen}
            onOpenChange={setNewOpen}
            onCreated={(id) => {
              void refreshWorkspaces();
              navigate({ view: 'workspace', workspaceId: id, tab: 'timeline' });
            }}
          />
          {selected && (
            <WorkspaceSettings
              me={account}
              workspaceId={selected.workspaceId}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              onChanged={onChanged}
            />
          )}
          <AccountSettings
            me={account}
            workspaces={workspaces}
            open={accountOpen}
            onOpenChange={setAccountOpen}
          />
        </>
      )}
    </div>
  );
}
