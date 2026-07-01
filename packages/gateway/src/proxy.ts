import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayContext } from './context.js';
import { notImplemented } from './http.js';

/**
 * Data-plane reverse proxy to the dumb relay (docs/protocol/transport.md +
 * workspace.md §data-plane + personal-store.md).
 *
 * The gateway authenticates the account key, resolves the store kind
 * (`psm_` personal / `wsp_` workspace), runs the COARSE membership/ownership ACL
 * via policy.authorize(), then forwards the request to the relay with the internal
 * token. Relay responses pass straight back — the wire shape is never
 * reinterpreted, so the relay stays the sole authority on the protocol (H010).
 *
 * @remarks Skeleton — routes wired in server.ts; bodies not yet ported.
 */

/** GET/POST /v1/projects/:storeId/events — authenticate + authorize + forward. */
export function handleEventsProxy(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
  storeId: string,
): void {
  notImplemented(res, `/v1/projects/${storeId}/events`);
}

/** GET /v1/account/personal-store — resolve the caller's account to its psm_ id. */
export function handlePersonalStore(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: GatewayContext,
): void {
  notImplemented(res, 'GET /v1/account/personal-store');
}
