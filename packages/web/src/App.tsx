import { BookText, Github, Plus, Settings, Users } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createWorkspace, getMe, listWorkspaces, type Me, type Workspace } from '@/lib/api';

function Sidebar({
  me,
  workspaces,
  selectedId,
  onSelect,
  onCreate,
}: {
  me: Me;
  workspaces: Workspace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="font-semibold">
          memorize <span className="text-muted-foreground">Hub</span>
        </span>
      </div>

      <nav className="px-2">
        <SidebarLink icon={<BookText />} label="Docs" href="/docs" />
        <SidebarLink icon={<Github />} label="GitHub" href="https://github.com/shakystar/memorize" />
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
                w.workspaceId === selectedId
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
        <a
          href="/account"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary hover:no-underline"
          title="Account settings"
        >
          <img
            src={`https://github.com/${encodeURIComponent(me.login)}.png?size=48`}
            alt=""
            className="h-7 w-7 rounded-full border border-border bg-secondary"
          />
          <span className="truncate">@{me.login}</span>
        </a>
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

function WorkspaceView({ workspace }: { workspace: Workspace }) {
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
          <Button variant="secondary" size="sm">
            <Users /> {workspace.memberCount}
          </Button>
          <Button variant="secondary" size="sm">
            <Settings /> Settings
          </Button>
        </div>
      </div>

      {/* main canvas: reserved for the memory read/write surface (H060) */}
      <div className="flex flex-1 items-center justify-center p-6">
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

  const load = useCallback(async () => {
    const m = await getMe();
    setMe(m);
    if (m) {
      const ws = await listWorkspaces();
      setWorkspaces(ws);
      setSelectedId((cur) => cur ?? ws[0]?.workspaceId ?? null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = useCallback(async () => {
    const name = window.prompt('New workspace name (optional)');
    if (name === null) return; // cancelled
    const { workspaceId } = await createWorkspace(name.trim());
    setWorkspaces(await listWorkspaces());
    setSelectedId(workspaceId);
  }, []);

  if (me === undefined) {
    return <CenteredCard>
      <p className="text-sm text-muted-foreground">Loading…</p>
    </CenteredCard>;
  }
  if (me === null) {
    return (
      <CenteredCard>
        <h1 className="text-lg font-semibold">memorize Hub</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with GitHub to manage workspaces and sync your memory.
        </p>
        <a href="/account/login" className="mt-5 inline-block">
          <Button>Sign in with GitHub</Button>
        </a>
      </CenteredCard>
    );
  }

  const selected = workspaces.find((w) => w.workspaceId === selectedId) ?? null;
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        me={me}
        workspaces={workspaces}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={onCreate}
      />
      <main className="min-w-0 flex-1">
        {selected ? (
          <WorkspaceView workspace={selected} />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm font-medium">No workspace selected</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a workspace to get started. A workspace with one member is a private project.
              </p>
              <Button className="mt-4" onClick={onCreate}>
                <Plus /> New workspace
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
