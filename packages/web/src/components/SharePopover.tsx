import { Check, ChevronDown, Link2, Lock, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
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
 * An inline role menu — deliberately NOT a Radix DropdownMenu, which would portal
 * outside the Share popover and make Radix dismiss it. This renders inside the
 * popover DOM, so there is no nested-layer conflict.
 */
function RoleMenu({
  role,
  self,
  busy,
  onSetRole,
  onRemove,
}: {
  role: 'owner' | 'member';
  self: boolean;
  busy: boolean;
  onSetRole: (r: 'owner' | 'member') => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const item =
    'flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary';
  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        className="gap-1 font-normal text-muted-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        {role} <ChevronDown className="size-3.5 opacity-60" />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-md">
          <button
            className={item}
            onClick={() => {
              setOpen(false);
              if (role !== 'owner') onSetRole('owner');
            }}
          >
            <Check className={cn('mt-0.5 size-4 shrink-0', role === 'owner' ? 'opacity-100' : 'opacity-0')} />
            <span>
              Owner
              <span className="block text-xs text-muted-foreground">Manage members, invites, delete</span>
            </span>
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false);
              if (role !== 'member') onSetRole('member');
            }}
          >
            <Check className={cn('mt-0.5 size-4 shrink-0', role === 'member' ? 'opacity-100' : 'opacity-0')} />
            <span>
              Member
              <span className="block text-xs text-muted-foreground">Sync and publish memory</span>
            </span>
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            className={cn(item, 'text-destructive')}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <span className="pl-6">{self ? 'Leave workspace' : 'Remove'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

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
      <PopoverContent
        align="end"
        className="w-96 p-0"
        onInteractOutside={(e) => {
          // A nested menu (role dropdown) portals outside this popover; interacting
          // with it must not dismiss the popover. The real clicked node is on
          // e.detail.originalEvent.target (e.target is the layer node), so check that.
          const target = e.detail.originalEvent.target as Element | null;
          if (target?.closest('[data-radix-popper-content-wrapper],[role="menu"]')) {
            e.preventDefault();
          }
        }}
      >
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
                    <RoleMenu
                      role={m.role}
                      self={self}
                      busy={busy}
                      onSetRole={(r) => void run(() => setMemberRole(workspaceId, m.accountId, r))}
                      onRemove={() => {
                        if (!window.confirm(self ? 'Leave this workspace?' : 'Remove this member?')) return;
                        void run(() => removeMember(workspaceId, m.accountId), self ? { removed: true } : undefined);
                      }}
                    />
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
