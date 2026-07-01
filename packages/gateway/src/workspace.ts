import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayContext } from './context.js';
import { notImplemented, readBody, sendError, sendJson } from './http.js';
import { authorize } from './policy.js';
import { resolvePrincipal } from './principal.js';
import { createStore, getStore, listAccountStores, roster } from './stores.js';

/**
 * Workspace control-plane handlers (docs/protocol/workspace.md). Each requires an
 * account principal (API key or session); mutations require an unscoped,
 * non-read_only key or a session (README §2-3). Visibility/role rules per README
 * §5 (non-member/unknown -> 404, wrong-role -> 403, invariant conflict -> 409).
 * Data rides the opaque events route in proxy.ts; only lifecycle/membership/invites
 * are typed here.
 *
 * @remarks S3 slice — create / discovery / roster implemented; invites + join +
 * member lifecycle (S4) and workspace delete (S4/S5) still return 501.
 */

const MAX_JSON_BODY = 64 * 1024;

/** Read + parse a JSON request body; empty body -> {}. Throws 400 on bad JSON. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req, MAX_JSON_BODY);
  if (buf.length === 0) return {};
  try {
    const value = JSON.parse(buf.toString('utf8')) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    throw Object.assign(new Error('invalid JSON'), { statusCode: 400 });
  }
}

/** POST /v1/workspaces — create (owner, sole member, invite_reachable=false). */
export async function createWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): Promise<void> {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');
  if (principal.readOnly) return sendError(res, 403, 'this key is read-only');
  if (principal.scoped) return sendError(res, 403, 'management requires an unscoped key');

  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, (error as { statusCode?: number }).statusCode ?? 400, 'bad request');
  }
  const nameRaw = body.name;
  if (nameRaw !== undefined && (typeof nameRaw !== 'string' || nameRaw.length > 200)) {
    return sendError(res, 400, 'name must be a string of at most 200 characters');
  }
  const name = typeof nameRaw === 'string' && nameRaw.length > 0 ? nameRaw : undefined;

  const { storeId } = createStore(ctx.db, principal.accountId, name);
  sendJson(res, 201, {
    workspaceId: storeId,
    eventsUrl: `/v1/projects/${storeId}/events`,
    role: 'owner',
    inviteReachable: false,
  });
}

/** GET /v1/account/workspaces — discovery (private + shared, with memberCount). */
export function listWorkspaces(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): void {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');
  if (principal.scoped) return sendError(res, 403, 'discovery requires an unscoped key');

  const workspaces = listAccountStores(ctx.db, principal.accountId).map((s) => ({
    workspaceId: s.storeId,
    eventsUrl: `/v1/projects/${s.storeId}/events`,
    role: s.role,
    name: s.name,
    inviteReachable: s.inviteReachable,
    memberCount: s.memberCount,
  }));
  sendJson(res, 200, { workspaces });
}

/** GET /v1/workspaces/:id — roster (any member; non-member/unknown -> 404). */
export function getWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
): void {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');

  const decision = authorize(ctx.db, principal, { kind: 'workspace', storeId }, 'read');
  if (!decision.ok) return sendError(res, decision.status, decision.error ?? 'forbidden');

  const store = getStore(ctx.db, storeId);
  if (!store) return sendError(res, 404, 'not found');
  const members = roster(ctx.db, storeId).map((m) => ({
    accountId: m.accountId,
    role: m.role,
    githubLogin: m.githubLogin,
    joinedAt: m.joinedAt,
  }));
  sendJson(res, 200, {
    workspaceId: storeId,
    name: store.name,
    inviteReachable: store.inviteReachable,
    members,
  });
}

/* --- invites + member lifecycle + delete (S4/S5) ----------------------------- */

/** POST /v1/workspaces/:id/invites — mint (owner); first mint flips to shared. */
export function mintInvite(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  storeId: string,
): void {
  notImplemented(res, `POST /v1/workspaces/${storeId}/invites`);
}

/** GET /v1/workspaces/:id/invites — list outstanding invites (owner). */
export function listInvites(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  storeId: string,
): void {
  notImplemented(res, `GET /v1/workspaces/${storeId}/invites`);
}

/** DELETE /v1/workspaces/:id/invites/:inviteId — revoke (owner, idempotent). */
export function revokeInvite(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  storeId: string,
  inviteId: string,
): void {
  notImplemented(res, `DELETE /v1/workspaces/${storeId}/invites/${inviteId}`);
}

/** POST /v1/workspaces/join — redeem an invite (CLI/key path). */
export function joinWorkspace(_req: IncomingMessage, res: ServerResponse, _ctx: GatewayContext): void {
  notImplemented(res, 'POST /v1/workspaces/join');
}

/** PATCH /v1/workspaces/:id/members/:accountId — role change / ownership transfer. */
export function setMemberRole(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  storeId: string,
  accountId: string,
): void {
  notImplemented(res, `PATCH /v1/workspaces/${storeId}/members/${accountId}`);
}

/** DELETE /v1/workspaces/:id/members/:accountId — remove (owner) or self-leave. */
export function removeMember(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  storeId: string,
  accountId: string,
): void {
  notImplemented(res, `DELETE /v1/workspaces/${storeId}/members/${accountId}`);
}

/** DELETE /v1/workspaces/:id — owner teardown (revokes all members). */
export function deleteWorkspace(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  storeId: string,
): void {
  notImplemented(res, `DELETE /v1/workspaces/${storeId}`);
}
