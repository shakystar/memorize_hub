import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayContext } from './context.js';
import { readBody, sendError, sendJson } from './http.js';
import {
  listInvites as dalListInvites,
  mintInvite as dalMintInvite,
  redeemInvite,
  revokeInvite as dalRevokeInvite,
  type MintInviteOptions,
} from './invites.js';
import { authorize } from './policy.js';
import { resolvePrincipal } from './principal.js';
import {
  createStore,
  deleteStore,
  getStore,
  listAccountStores,
  memberRole,
  removeMember as dalRemoveMember,
  roster,
  setRole as dalSetRole,
} from './stores.js';
import { originFor } from './views.js';

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

/* --- invites + member lifecycle + delete (S4) -------------------------------- */

function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

/** POST /v1/workspaces/:id/invites — mint (owner); first mint flips to shared. */
export async function mintInvite(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
): Promise<void> {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');
  const decision = authorize(ctx.db, principal, { kind: 'workspace', storeId }, 'admin');
  if (!decision.ok) return sendError(res, decision.status, decision.error ?? 'forbidden');

  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, (error as { statusCode?: number }).statusCode ?? 400, 'bad request');
  }

  const opts: MintInviteOptions = {};
  const { maxUses, expiresAt } = body;
  if (maxUses !== undefined && maxUses !== null) {
    if (typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses <= 0) {
      return sendError(res, 400, 'maxUses must be a positive integer');
    }
    opts.maxUses = maxUses;
  }
  if (expiresAt !== undefined && expiresAt !== null) {
    const t = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
    if (Number.isNaN(t) || t <= Date.now()) {
      return sendError(res, 400, 'expiresAt must be a future ISO-8601 timestamp');
    }
    opts.expiresAt = expiresAt as string;
  }

  const minted = dalMintInvite(ctx.db, storeId, principal.accountId, opts);
  const joinUrl = `${originFor(req, ctx.config)}/join?token=${encodeURIComponent(minted.token)}`;
  sendJson(res, 201, {
    inviteId: minted.inviteId,
    token: minted.token,
    joinUrl,
    role: minted.role,
    maxUses: minted.maxUses,
    expiresAt: minted.expiresAt,
  });
}

/** GET /v1/workspaces/:id/invites — list outstanding invites (owner; read-only ok). */
export function listInvites(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
): void {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');
  if (principal.scoped) return sendError(res, 403, 'management requires an unscoped key');
  const role = memberRole(ctx.db, storeId, principal.accountId);
  if (!role) return sendError(res, 404, 'not found'); // existence-leak
  if (role !== 'owner') return sendError(res, 403, 'owner only');
  sendJson(res, 200, { invites: dalListInvites(ctx.db, storeId) });
}

/** DELETE /v1/workspaces/:id/invites/:inviteId — revoke (owner, idempotent). */
export function revokeInvite(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
  inviteId: string,
): void {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');
  const decision = authorize(ctx.db, principal, { kind: 'workspace', storeId }, 'admin');
  if (!decision.ok) return sendError(res, decision.status, decision.error ?? 'forbidden');
  if (!dalRevokeInvite(ctx.db, storeId, inviteId)) return sendError(res, 404, 'not found');
  sendNoContent(res);
}

/** POST /v1/workspaces/join — redeem an invite (CLI/key path). */
export async function joinWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): Promise<void> {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');
  if (principal.readOnly) return sendError(res, 403, 'this key is read-only');
  if (principal.scoped) return sendError(res, 403, 'join requires an unscoped key');

  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, (error as { statusCode?: number }).statusCode ?? 400, 'bad request');
  }
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token) return sendError(res, 400, 'token is required');

  const result = redeemInvite(ctx.db, token, principal.accountId);
  if (!result.ok) return sendError(res, 403, 'invalid, revoked, expired, or exhausted invite');
  sendJson(res, 200, {
    workspaceId: result.storeId,
    eventsUrl: `/v1/projects/${result.storeId}/events`,
    role: result.role,
  });
}

/** PATCH /v1/workspaces/:id/members/:accountId — role change / ownership transfer. */
export async function setMemberRole(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
  accountId: string,
): Promise<void> {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');
  const decision = authorize(ctx.db, principal, { kind: 'workspace', storeId }, 'admin');
  if (!decision.ok) return sendError(res, decision.status, decision.error ?? 'forbidden');

  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendError(res, (error as { statusCode?: number }).statusCode ?? 400, 'bad request');
  }
  const role = body.role;
  if (role !== 'owner' && role !== 'member') return sendError(res, 400, "role must be 'owner' or 'member'");

  const result = dalSetRole(ctx.db, storeId, accountId, role);
  if (!result.ok) {
    return result.reason === 'last_owner'
      ? sendError(res, 409, 'cannot demote the sole remaining owner')
      : sendError(res, 404, 'not found');
  }
  sendJson(res, 200, { accountId, role });
}

/** DELETE /v1/workspaces/:id/members/:accountId — remove (owner) or self-leave. */
export function removeMember(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
  accountId: string,
): void {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');
  if (principal.readOnly) return sendError(res, 403, 'this key is read-only');
  if (principal.scoped) return sendError(res, 403, 'membership changes require an unscoped key');

  // Two authorized callers: an owner removing anyone, or a member removing self.
  const callerRole = memberRole(ctx.db, storeId, principal.accountId);
  if (!callerRole) return sendError(res, 404, 'not found'); // non-member can't observe
  if (accountId !== principal.accountId && callerRole !== 'owner') {
    return sendError(res, 403, 'only an owner may remove another member');
  }

  const result = dalRemoveMember(ctx.db, storeId, accountId);
  if (!result.ok) {
    return result.reason === 'last_owner'
      ? sendError(res, 409, 'transfer ownership or delete the workspace first')
      : sendError(res, 404, 'not found');
  }
  sendNoContent(res);
}

/** DELETE /v1/workspaces/:id — owner teardown (revokes all members). */
export function deleteWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
): void {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');
  const decision = authorize(ctx.db, principal, { kind: 'workspace', storeId }, 'admin');
  if (!decision.ok) return sendError(res, decision.status, decision.error ?? 'forbidden');
  deleteStore(ctx.db, storeId);
  sendNoContent(res);
}
