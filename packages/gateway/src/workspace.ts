import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayContext } from './context.js';
import { notImplemented } from './http.js';

/**
 * Workspace control-plane handlers (docs/protocol/workspace.md). Each requires an
 * account principal; mutations require an unscoped, non-read_only key or a session
 * (README §2-3). Visibility/role rules per README §5 (non-member/unknown -> 404,
 * wrong-role -> 403, invariant conflict -> 409). Data rides the opaque events
 * route in proxy.ts; only lifecycle/membership/invites are typed here.
 *
 * @remarks Skeleton — routes wired in server.ts; bodies not yet ported. `_req`/
 * `_ctx` are unused until the port lands.
 */

/** POST /v1/workspaces — create (owner, sole member, invite_reachable=false). */
export function createWorkspace(_req: IncomingMessage, res: ServerResponse, _ctx: GatewayContext): void {
  notImplemented(res, 'POST /v1/workspaces');
}

/** GET /v1/account/workspaces — discovery (private + shared, with memberCount). */
export function listWorkspaces(_req: IncomingMessage, res: ServerResponse, _ctx: GatewayContext): void {
  notImplemented(res, 'GET /v1/account/workspaces');
}

/** GET /v1/workspaces/:id — roster (any member). */
export function getWorkspace(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  storeId: string,
): void {
  notImplemented(res, `GET /v1/workspaces/${storeId}`);
}

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
