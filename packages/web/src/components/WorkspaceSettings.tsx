import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { deleteWorkspace, getWorkspace, renameWorkspace, type Me, type WorkspaceDetail } from '@/lib/api';

/**
 * Workspace settings — a small centered dialog for owner-only General settings
 * (rename, delete). Sharing (members/invites) lives in the Share popover, not here.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = detail?.members.find((m) => m.accountId === me.accountId)?.role === 'owner';

  const load = useCallback(async () => {
    setDetail(await getWorkspace(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    if (open) {
      setError(null);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Workspace settings</DialogTitle>
          <DialogDescription>
            <code className="font-mono">{workspaceId}</code> ·{' '}
            {detail?.inviteReachable ? 'shared' : 'private'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        {isOwner && detail ? (
          <div className="space-y-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const value = String(new FormData(e.currentTarget).get('name') ?? '');
                void run(() => renameWorkspace(workspaceId, value));
              }}
            >
              <label className="block text-xs text-muted-foreground">Name</label>
              <div className="mt-1 flex gap-2">
                <Input name="name" defaultValue={detail.name ?? ''} maxLength={200} />
                <Button type="submit" variant="secondary" disabled={busy}>
                  Save
                </Button>
              </div>
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
        ) : (
          <p className="text-sm text-muted-foreground">Only an owner can change these settings.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
