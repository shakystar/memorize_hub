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

export interface Member {
  accountId: string;
  role: 'owner' | 'member';
  githubLogin: string | null;
  joinedAt: string;
}

export interface WorkspaceDetail {
  workspaceId: string;
  name: string | null;
  inviteReachable: boolean;
  members: Member[];
}

export interface InviteRow {
  inviteId: string;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const q = (id: string) => encodeURIComponent(id);

async function ok(res: Response, what: string): Promise<void> {
  if (!res.ok) throw new Error(`${what} -> ${res.status}`);
}

/** Workspace roster (any member). */
export async function getWorkspace(id: string): Promise<WorkspaceDetail> {
  const res = await fetch(`/v1/workspaces/${q(id)}`, { credentials: 'same-origin' });
  await ok(res, `GET /v1/workspaces/${id}`);
  return (await res.json()) as WorkspaceDetail;
}

/** Outstanding invites (owner). */
export async function listInvites(id: string): Promise<InviteRow[]> {
  const res = await fetch(`/v1/workspaces/${q(id)}/invites`, { credentials: 'same-origin' });
  await ok(res, `GET invites`);
  return ((await res.json()) as { invites: InviteRow[] }).invites;
}

/** Mint an invite (owner); returns the one-time join URL. */
export async function mintInvite(id: string): Promise<{ inviteId: string; joinUrl: string }> {
  const res = await fetch(`/v1/workspaces/${q(id)}/invites`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  await ok(res, `POST invites`);
  return (await res.json()) as { inviteId: string; joinUrl: string };
}

export async function revokeInvite(id: string, inviteId: string): Promise<void> {
  const res = await fetch(`/v1/workspaces/${q(id)}/invites/${q(inviteId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  await ok(res, `DELETE invite`);
}

export async function setMemberRole(
  id: string,
  accountId: string,
  role: 'owner' | 'member',
): Promise<void> {
  const res = await fetch(`/v1/workspaces/${q(id)}/members/${q(accountId)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (res.status === 409) throw new Error('Cannot demote the sole remaining owner.');
  await ok(res, `PATCH member role`);
}

export async function removeMember(id: string, accountId: string): Promise<void> {
  const res = await fetch(`/v1/workspaces/${q(id)}/members/${q(accountId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (res.status === 409) throw new Error('The last owner cannot be removed — transfer ownership or delete the workspace.');
  await ok(res, `DELETE member`);
}

export async function deleteWorkspace(id: string): Promise<void> {
  const res = await fetch(`/v1/workspaces/${q(id)}`, { method: 'DELETE', credentials: 'same-origin' });
  await ok(res, `DELETE workspace`);
}
