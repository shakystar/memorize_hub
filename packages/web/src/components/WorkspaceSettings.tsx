import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  deleteWorkspace,
  getWorkspace,
  listInvites,
  mintInvite,
  removeMember,
  revokeInvite,
  setMemberRole,
  type InviteRow,
  type Me,
  type WorkspaceDetail,
} from '@/lib/api';

/**
 * Workspace settings panel (members / invites / settings). Surfaces the existing
 * control-plane APIs. Owner-only controls are gated on the caller's role. Not-yet
 * features (rename, icon/color, publish policy) are shown as "개발 예정", not crammed.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            <code className="font-mono">{workspaceId}</code> ·{' '}
            {detail?.inviteReachable ? 'shared' : 'private'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Members */}
        <section>
          <h3 className="text-sm font-semibold">Members</h3>
          <div className="mt-2 divide-y divide-border">
            {detail?.members.map((m) => {
              const self = m.accountId === me.accountId;
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
                    {(isOwner || self) && (
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
        </section>

        {/* Invites (owner) */}
        {isOwner && (
          <section>
            <h3 className="text-sm font-semibold">Invites</h3>
            {mintedUrl && (
              <div className="mt-2 rounded-md border border-border bg-secondary p-3">
                <p className="text-xs font-medium">Invite link (share it; shown once):</p>
                <code className="mt-1 block overflow-x-auto whitespace-nowrap text-xs font-mono">
                  {mintedUrl}
                </code>
              </div>
            )}
            <div className="mt-2 divide-y divide-border">
              {activeInvites.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No active invites.</p>
              ) : (
                activeInvites.map((i) => (
                  <div key={i.inviteId} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {i.inviteId} · {i.maxUses === null ? `${i.usedCount}/∞` : `${i.usedCount}/${i.maxUses}`}
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
            <Button
              className="mt-3"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { joinUrl } = await mintInvite(workspaceId);
                  setMintedUrl(joinUrl);
                })
              }
            >
              Create invite link
            </Button>
          </section>
        )}

        {/* Settings */}
        <section>
          <h3 className="text-sm font-semibold">Settings</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {isOwner && (
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
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Rename, icon/color, and publish policy —{' '}
            <span className="rounded-full border border-border px-2 py-0.5">개발 예정</span>
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
