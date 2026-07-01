import { useCallback, useEffect, useState } from 'react';

import { WorkspaceScopeSelect } from '@/components/WorkspaceScopeSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { issueKey, listKeys, revokeKey, type Me, type TokenSummary, type Workspace } from '@/lib/api';

type Tab = 'account' | 'keys';

/**
 * Personal settings (account-scoped), rendered inside the app shell as a
 * categorized dialog: Account (identity + personal memory) / API keys.
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
  const [tab, setTab] = useState<Tab>('account');
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
      setTab('account');
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

  const tabBtn = (id: Tab, text: string) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        'block w-full rounded-md px-3 py-1.5 text-left text-sm',
        tab === id
          ? 'bg-secondary font-medium text-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {text}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-5xl">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle>Account</DialogTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            @{me.login} · <span className="font-mono">{me.email}</span>
          </p>
        </div>

        <div className="grid min-h-[22rem] grid-cols-[11rem_1fr]">
          <nav className="space-y-1 border-r border-border p-3">
            {tabBtn('account', 'Account')}
            {tabBtn('keys', 'API keys')}
          </nav>

          <div className="max-h-[70vh] overflow-y-auto p-6">
            {error && (
              <p className="mb-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            {tab === 'account' && (
              <section>
                <h3 className="text-sm font-semibold">Personal memory</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Private, account-scoped memory that follows you across machines. Never shared. Any
                  unscoped key syncs it.
                </p>
                <code className="mt-2 block font-mono text-sm">{me.personalStoreId}</code>
                <div className="mt-6">
                  <a href="/account/logout">
                    <Button variant="secondary" size="sm">
                      Sign out
                    </Button>
                  </a>
                </div>
              </section>
            )}

            {tab === 'keys' && (
              <section>
                {minted && (
                  <div className="mb-4 rounded-md border border-border bg-secondary p-3">
                    <p className="text-xs font-medium">New key — copy it now, it is shown only once:</p>
                    <code className="mt-1 block overflow-x-auto whitespace-nowrap text-xs font-mono">
                      {minted}
                    </code>
                  </div>
                )}
                <div className="divide-y divide-border">
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

                <div className="mt-4 space-y-3 rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    Mint a key. Leave scopes unchecked for an unscoped key (personal memory + every
                    workspace); check workspaces for a data-plane-only scoped key.
                  </p>
                  <Input
                    placeholder="Label (optional), e.g. laptop"
                    maxLength={80}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                  {workspaces.length > 0 && (
                    <div>
                      <span className="mb-1 block text-xs text-muted-foreground">Scope</span>
                      <WorkspaceScopeSelect
                        workspaces={workspaces}
                        selected={scopes}
                        onToggle={toggleScope}
                      />
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
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
