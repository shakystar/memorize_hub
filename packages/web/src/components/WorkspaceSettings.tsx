import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  deleteWorkspace,
  getWorkspace,
  listInvites,
  mintInvite,
  removeMember,
  renameWorkspace,
  revokeInvite,
  setMemberRole,
  type InviteRow,
  type Me,
  type WorkspaceDetail,
} from '@/lib/api';

type Tab = 'members' | 'invites' | 'general';

/**
 * Workspace settings — a categorized dialog (left tab nav + right pane) instead of
 * one long stacked scroll. Members (all), Invites (owner), General (owner: rename /
 * delete). Not-yet features (icon/color, publish policy) are labeled, not crammed.
 */
export function WorkspaceSettings({
  me,
  workspaceId,
  open,
  onOpenChange,
  onChanged,
}: {
  me: Me;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (opts?: { removed?: boolean }) => void;
}) {
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('members');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const isOwner = detail?.members.find((m) => m.accountId === me.accountId)?.role === 'owner';

  const load = useCallback(async () => {
    setError(null);
    const d = await getWorkspace(workspaceId);
    setDetail(d);
    const owner = d.members.find((m) => m.accountId === me.accountId)?.role === 'owner';
    setInvites(owner ? await listInvites(workspaceId) : []);
  }, [workspaceId, me.accountId]);

  useEffect(() => {
    if (open) {
      setMintedUrl(null);
      setTab('members');
      void load().catch((e: unknown) => setError(String(e)));
    }
  }, [open, load]);

  const run = async (fn: () => Promise<void>, opts?: { removed?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (opts?.removed) {
        onChanged({ removed: true });
        onOpenChange(false);
      } else {
        await load();
        onChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const name = detail?.name ?? 'untitled';
  const activeInvites = invites.filter(
    (i) =>
      !i.revokedAt &&
      (!i.expiresAt || Date.parse(i.expiresAt) > Date.now()) &&
      (i.maxUses === null || i.usedCount < i.maxUses),
  );

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        'block w-full rounded-md px-3 py-1.5 text-left text-sm',
        tab === id
          ? 'bg-secondary font-medium text-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle>{name}</DialogTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <code className="font-mono">{workspaceId}</code> ·{' '}
            {detail?.inviteReachable ? 'shared' : 'private'}
          </p>
        </div>

        <div className="grid min-h-[22rem] grid-cols-[11rem_1fr]">
          <nav className="space-y-1 border-r border-border p-3">
            {tabBtn('members', 'Members')}
            {isOwner && tabBtn('invites', 'Invites')}
            {isOwner && tabBtn('general', 'General')}
          </nav>

          <div className="max-h-[70vh] overflow-y-auto p-6">
            {error && (
              <p className="mb-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            {tab === 'members' && (
              <div className="divide-y divide-border">
                {detail?.members.map((m) => {
                  const self = m.accountId === me.accountId;
                  const showLeave = self && detail.members.length > 1;
                  const showRemove = !self && isOwner;
                  return (
                    <div key={m.accountId} className="flex items-center justify-between py-2 text-sm">
                      <span>
                        {m.githubLogin ? `@${m.githubLogin}` : m.accountId}
                        {self && <span className="text-muted-foreground"> (you)</span>}
                        <span className="ml-2 text-xs text-muted-foreground">{m.role}</span>
                      </span>
                      <div className="flex gap-2">
                        {isOwner && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              run(() =>
                                setMemberRole(workspaceId, m.accountId, m.role === 'owner' ? 'member' : 'owner'),
                              )
                            }
                          >
                            {m.role === 'owner' ? 'Make member' : 'Make owner'}
                          </Button>
                        )}
                        {(showLeave || showRemove) && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(self ? 'Leave this workspace?' : 'Remove this member?')) return;
                              void run(() => removeMember(workspaceId, m.accountId), self ? { removed: true } : undefined);
                            }}
                          >
                            {self ? 'Leave' : 'Remove'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'invites' && isOwner && (
              <div>
                {mintedUrl && (
                  <div className="mb-4 rounded-md border border-border bg-secondary p-3">
                    <p className="text-xs font-medium">Invite link (share it; shown once):</p>
                    <code className="mt-1 block overflow-x-auto whitespace-nowrap text-xs font-mono">
                      {mintedUrl}
                    </code>
                  </div>
                )}
                <div className="divide-y divide-border">
                  {activeInvites.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">No active invites.</p>
                  ) : (
                    activeInvites.map((i) => (
                      <div key={i.inviteId} className="flex items-center justify-between py-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">
                          {i.inviteId} · {i.maxUses === null ? `${i.usedCount}/∞` : `${i.usedCount}/${i.maxUses}`}
                          {i.expiresAt ? ` · expires ${new Date(i.expiresAt).toLocaleDateString()}` : ''}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => void run(() => revokeInvite(workspaceId, i.inviteId))}
                        >
                          Revoke
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 space-y-3 rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    Create an invite link. Leave the limits blank for an unlimited, never-expiring link.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <label className="text-sm">
                      <span className="block text-xs text-muted-foreground">Max uses</span>
                      <Input
                        type="number"
                        min={1}
                        placeholder="∞"
                        className="mt-1 w-28"
                        value={maxUses}
                        onChange={(e) => setMaxUses(e.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="block text-xs text-muted-foreground">Expires</span>
                      <Input
                        type="datetime-local"
                        className="mt-1 w-56"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                      />
                    </label>
                  </div>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const opts: { maxUses?: number; expiresAt?: string } = {};
                        const mu = parseInt(maxUses, 10);
                        if (maxUses.trim() && Number.isInteger(mu) && mu > 0) opts.maxUses = mu;
                        if (expiresAt.trim()) opts.expiresAt = new Date(expiresAt).toISOString();
                        const { joinUrl } = await mintInvite(workspaceId, opts);
                        setMintedUrl(joinUrl);
                        setMaxUses('');
                        setExpiresAt('');
                      })
                    }
                  >
                    Create invite link
                  </Button>
                </div>
              </div>
            )}

            {tab === 'general' && isOwner && detail && (
              <div className="space-y-6">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = String(new FormData(e.currentTarget).get('name') ?? '');
                    void run(() => renameWorkspace(workspaceId, value));
                  }}
                  className="flex items-end gap-2"
                >
                  <div>
                    <label className="block text-xs text-muted-foreground">Name</label>
                    <Input name="name" defaultValue={detail.name ?? ''} maxLength={200} className="mt-1 w-64" />
                  </div>
                  <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                    Save
                  </Button>
                </form>

                <div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm('Delete this workspace? Members lose access. This cannot be undone.')) return;
                      void run(() => deleteWorkspace(workspaceId), { removed: true });
                    }}
                  >
                    Delete workspace
                  </Button>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Icon/color and publish policy —{' '}
                    <span className="rounded-full border border-border px-2 py-0.5">개발 예정</span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
