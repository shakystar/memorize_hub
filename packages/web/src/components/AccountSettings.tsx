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
import { issueKey, listKeys, revokeKey, type Me, type TokenSummary, type Workspace } from '@/lib/api';

/**
 * Personal settings (account-scoped), rendered inside the app shell instead of
 * linking out to the legacy /account page: personal memory id, API keys
 * (list / generate / revoke), and sign out.
 */
export function AccountSettings({
  me,
  workspaces,
  open,
  onOpenChange,
}: {
  me: Me;
  workspaces: Workspace[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [keys, setKeys] = useState<TokenSummary[]>([]);
  const [minted, setMinted] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setKeys(await listKeys());
  }, []);

  useEffect(() => {
    if (open) {
      setMinted(null);
      setError(null);
      void load().catch((e: unknown) => setError(String(e)));
    }
  }, [open, load]);

  const active = keys.filter((k) => !k.revokedAt);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const opts: { label?: string; readOnly?: boolean; storeIds?: string[] } = { readOnly };
      if (label.trim()) opts.label = label.trim();
      if (scopes.size > 0) opts.storeIds = [...scopes];
      const key = await issueKey(opts);
      setMinted(key);
      setLabel('');
      setReadOnly(false);
      setScopes(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this key? Machines using it stop syncing.')) return;
    setBusy(true);
    try {
      await revokeKey(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleScope = (id: string) =>
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            @{me.login} · <span className="font-mono">{me.email}</span>
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <section>
          <h3 className="text-sm font-semibold">Personal memory</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Private, account-scoped memory that follows you across machines. Never shared. Any
            unscoped key syncs it.
          </p>
          <code className="mt-2 block font-mono text-sm">{me.personalStoreId}</code>
        </section>

        <section>
          <h3 className="text-sm font-semibold">API keys</h3>
          {minted && (
            <div className="mt-2 rounded-md border border-border bg-secondary p-3">
              <p className="text-xs font-medium">New key — copy it now, it is shown only once:</p>
              <code className="mt-1 block overflow-x-auto whitespace-nowrap text-xs font-mono">{minted}</code>
            </div>
          )}
          <div className="mt-2 divide-y divide-border">
            {active.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No active keys.</p>
            ) : (
              active.map((k) => (
                <div key={k.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <code className="font-mono">{k.prefix}…</code>
                    {k.readOnly && <span className="text-muted-foreground"> (read-only)</span>}
                    {k.label && <span className="ml-2 text-muted-foreground">{k.label}</span>}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {k.scopes.length === 0 ? 'all stores' : `${k.scopes.length} workspace(s)`}
                    </span>
                  </span>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void revoke(k.id)}>
                    Revoke
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* generate */}
          <div className="mt-4 space-y-3 rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">
              Mint a key. Leave scopes unchecked for an unscoped key (syncs personal memory + every
              workspace); check workspaces for a data-plane-only scoped key.
            </p>
            <Input
              placeholder="Label (optional), e.g. laptop"
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            {workspaces.length > 0 && (
              <div className="space-y-1">
                {workspaces.map((w) => (
                  <label key={w.workspaceId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={scopes.has(w.workspaceId)}
                      onChange={() => toggleScope(w.workspaceId)}
                    />
                    <span className="font-mono text-xs">{w.workspaceId}</span>
                    {w.name && <span className="text-muted-foreground">({w.name})</span>}
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
              read-only key (pull only)
            </label>
            <Button size="sm" disabled={busy} onClick={() => void generate()}>
              Generate a new key
            </Button>
          </div>
        </section>

        <section className="flex justify-end">
          <a href="/account/logout">
            <Button variant="secondary" size="sm">
              Sign out
            </Button>
          </a>
        </section>
      </DialogContent>
    </Dialog>
  );
}
