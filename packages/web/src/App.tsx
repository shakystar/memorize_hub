import { BookText, BrainCircuit, Github, Plus, Settings } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { AccountSettings } from '@/components/AccountSettings';
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

function Sidebar({
  me,
  workspaces,
  selectedId,
  view,
  onSelect,
  onSelectPersonal,
  onCreate,
  onOpenAccount,
}: {
  me: Me;
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
  workspace,
  onOpenSettings,
  onChanged,
}: {
  me: Me;
  workspace: Workspace;
  onOpenSettings: () => void;
  onChanged: (opts?: { removed?: boolean }) => void;
}) {
  const origin = window.location.origin;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">{workspace.name ?? 'untitled'}</h1>
          <span className="text-xs text-muted-foreground">
            {workspace.inviteReachable ? 'shared' : 'private'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SharePopover me={me} workspaceId={workspace.workspaceId} onChanged={onChanged} />
          {workspace.role === 'owner' && (
            <Button variant="ghost" size="icon" onClick={onOpenSettings} title="Workspace settings">
              <Settings />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        {/* main canvas: reserved for the memory read/write surface (H060) */}
        <div className="max-w-md rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">Workspace memory</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Browsing and querying this workspace&apos;s memory arrives with the read surface
            (a separate headless memorize replica). Reserved here.
          </p>
          <p className="mt-3 inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            개발 예정
          </p>
        </div>

        {/* sync quickstart */}
        <div className="w-full max-w-xl">
          <p className="text-xs text-muted-foreground">
            Sync a local folder into this workspace (needs a key from your account, memorize 2.5.0+):
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-card px-3 py-2 text-xs font-mono">
            memorize auth login --remote-url {origin} --token YOUR_KEY
          </pre>
        </div>
      </div>
    </div>
  );
}

function PersonalMemoryView({ me }: { me: Me }) {
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
        <div className="w-full max-w-xl">
          <p className="text-xs text-muted-foreground">Personal store id</p>
          <code className="mt-1 block font-mono text-sm">{me.personalStoreId}</code>
        </div>
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [view, setView] = useState<'workspace' | 'personal'>('workspace');

  const refreshWorkspaces = useCallback(async () => {
    const ws = await listWorkspaces();
    setWorkspaces(ws);
    return ws;
  }, []);

  const load = useCallback(async () => {
    const m = await getMe();
    setMe(m);
    if (m) {
      const ws = await refreshWorkspaces();
      setSelectedId((cur) => cur ?? ws[0]?.workspaceId ?? null);
    }
  }, [refreshWorkspaces]);

  useEffect(() => {
    void load();
  }, [load]);

  if (me === undefined) {
    return <CenteredCard>
      <p className="text-sm text-muted-foreground">Loading…</p>
    </CenteredCard>;
  }
  if (me === null) {
    return (
      <CenteredCard>
        <h1 className="text-lg font-semibold">Memorize Hub</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with Google to manage workspaces and sync your memory.
        </p>
        <a href="/account/login" className="mt-5 inline-block">
          <Button>Sign in with Google</Button>
        </a>
      </CenteredCard>
    );
  }

  const selected = workspaces.find((w) => w.workspaceId === selectedId) ?? null;
  const onChanged = async (opts?: { removed?: boolean }) => {
    const ws = await refreshWorkspaces();
    if (opts?.removed) setSelectedId(ws[0]?.workspaceId ?? null);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        me={me}
        workspaces={workspaces}
        selectedId={selectedId}
        view={view}
        onSelect={(id) => {
          setSelectedId(id);
          setView('workspace');
        }}
        onSelectPersonal={() => setView('personal')}
        onCreate={() => setNewOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
      />
      <main className="min-w-0 flex-1">
        {view === 'personal' ? (
          <PersonalMemoryView me={me} />
        ) : selected ? (
          <WorkspaceView
            me={me}
            workspace={selected}
            onOpenSettings={() => setSettingsOpen(true)}
            onChanged={onChanged}
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

      <NewWorkspaceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => {
          void refreshWorkspaces();
          setSelectedId(id);
        }}
      />
      {selected && (
        <WorkspaceSettings
          me={me}
          workspaceId={selected.workspaceId}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onChanged={onChanged}
        />
      )}
      <AccountSettings me={me} workspaces={workspaces} open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  );
}
