/**
 * Thin client for the gateway control-plane JSON API. Same-origin: the gateway
 * serves this SPA and the API, so the session cookie flows automatically. The
 * gateway stays the only backend; this never talks to the relay directly.
 */

export interface Me {
  accountId: string;
  login: string;
  email: string;
}

export interface Workspace {
  workspaceId: string;
  eventsUrl: string;
  role: 'owner' | 'member';
  name: string | null;
  inviteReachable: boolean;
  memberCount: number;
}

/** Resolve the signed-in account, or null if the session is missing/expired. */
export async function getMe(): Promise<Me | null> {
  const res = await fetch('/account/me', { credentials: 'same-origin' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /account/me -> ${res.status}`);
  return (await res.json()) as Me;
}

/** List the account's workspaces (private + shared). */
export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await fetch('/v1/account/workspaces', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`GET /v1/account/workspaces -> ${res.status}`);
  const body = (await res.json()) as { workspaces: Workspace[] };
  return body.workspaces;
}

/** Create a workspace; returns the new workspace id. */
export async function createWorkspace(name: string): Promise<{ workspaceId: string }> {
  const res = await fetch('/v1/workspaces', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });
  if (!res.ok) throw new Error(`POST /v1/workspaces -> ${res.status}`);
  return (await res.json()) as { workspaceId: string };
}
