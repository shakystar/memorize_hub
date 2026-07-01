import { Check, ChevronDown, Link2, Lock, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  getWorkspace,
  mintInvite,
  removeMember,
  setMemberRole,
  type Me,
  type WorkspaceDetail,
} from '@/lib/api';

/**
 * Notion-style Share: a compact popover (not a centered dialog) anchored to a
 * "Share" button. People-with-access list with per-member role dropdowns, a
 * general-access line, and a "Copy link" footer that mints + copies an invite link
 * (our invites are link-based, so there is no email row).
 */
export function SharePopover({
  me,
  workspaceId,
  onChanged,
}: {
  me: Me;
  workspaceId: string;
  onChanged: (opts?: { removed?: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedLink, setCachedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isOwner = detail?.members.find((m) => m.accountId === me.accountId)?.role === 'owner';

  const load = useCallback(async () => {
    setDetail(await getWorkspace(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    if (open) {
      setError(null);
      setCachedLink(null);
      setCopied(false);
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
        setOpen(false);
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

  const copyLink = async () => {
    setBusy(true);
    setError(null);
    try {
      let url = cachedLink;
      if (!url) {
        url = (await mintInvite(workspaceId)).joinUrl;
        setCachedLink(url);
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          <Users /> Share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="p-3">
          {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
          <p className="mb-1 text-xs font-medium text-muted-foreground">People with access</p>
          <div>
            {detail?.members.map((m) => {
              const self = m.accountId === me.accountId;
              const showSelfLeave = self && detail.members.length > 1;
              return (
                <div key={m.accountId} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full border border-border bg-secondary text-xs">
                      {(m.githubLogin ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="truncate">
                      {m.githubLogin ? `@${m.githubLogin}` : m.accountId}
                      {self && <span className="text-muted-foreground"> (you)</span>}
                    </span>
                  </div>
                  {isOwner ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-1 font-normal text-muted-foreground">
                          {m.role} <ChevronDown className="size-3.5 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuItem
                          className="flex-col items-start gap-0"
                          onSelect={() => {
                            if (m.role !== 'owner') void run(() => setMemberRole(workspaceId, m.accountId, 'owner'));
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Check className={cn('size-4', m.role === 'owner' ? 'opacity-100' : 'opacity-0')} /> Owner
                          </span>
                          <span className="pl-6 text-xs text-muted-foreground">Manage members, invites, delete</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="flex-col items-start gap-0"
                          onSelect={() => {
                            if (m.role !== 'member') void run(() => setMemberRole(workspaceId, m.accountId, 'member'));
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Check className={cn('size-4', m.role === 'member' ? 'opacity-100' : 'opacity-0')} /> Member
                          </span>
                          <span className="pl-6 text-xs text-muted-foreground">Sync and publish memory</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => {
                            if (!window.confirm(self ? 'Leave this workspace?' : 'Remove this member?')) return;
                            void run(() => removeMember(workspaceId, m.accountId), self ? { removed: true } : undefined);
                          }}
                        >
                          {self ? 'Leave workspace' : 'Remove'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : showSelfLeave ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm('Leave this workspace?')) return;
                        void run(() => removeMember(workspaceId, m.accountId), { removed: true });
                      }}
                    >
                      Leave
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{m.role}</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">General access</p>
            <div className="flex items-center gap-2 text-sm">
              <span className="flex size-6 items-center justify-center rounded-full bg-secondary">
                <Lock className="size-3.5 text-muted-foreground" />
              </span>
              {detail?.inviteReachable ? 'Anyone with an invite link' : 'Only people invited'}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border p-3">
          <a
            href="/docs/workspaces"
            className="text-xs text-muted-foreground hover:text-foreground hover:no-underline"
          >
            Learn about sharing
          </a>
          {isOwner && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void copyLink()}>
              <Link2 /> {copied ? 'Copied' : 'Copy link'}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
