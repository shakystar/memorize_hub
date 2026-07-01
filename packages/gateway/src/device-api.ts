import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayContext } from './context.js';
import { pollDeviceToken, startDeviceAuth } from './device.js';
import { readBody, sendError, sendJson } from './http.js';
import { issueApiKey } from './keys.js';

/**
 * Device Authorization Grant JSON endpoints (docs/protocol/device-auth.md). Both
 * are UNAUTHENTICATED: `device_code` is itself the bearer of authority, and the
 * approval that binds an account happens in the browser at `/device` (web.ts).
 */

const MAX_JSON = 4 * 1024;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req, MAX_JSON);
  if (buf.length === 0) return {};
  const value = JSON.parse(buf.toString('utf8')) as unknown;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** POST /v1/device/code — begin a device authorization; returns codes + poll params. */
export async function handleDeviceCode(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): Promise<void> {
  // verification_uri needs a public origin; without it the flow can't complete.
  if (!ctx.config.publicUrl) return sendError(res, 503, 'device authorization not configured');
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch {
    return sendError(res, 400, 'invalid JSON');
  }
  const label =
    typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 64) : undefined;
  sendJson(res, 200, startDeviceAuth(ctx.db, ctx.config, Date.now(), label));
}

/**
 * POST /v1/device/token — poll for the minted key. RFC 8628 error strings in the
 * body; on the first approved poll the key is minted and the grant consumed.
 */
export async function handleDeviceToken(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch {
    return sendError(res, 400, 'invalid JSON');
  }
  const deviceCode = typeof body.device_code === 'string' ? body.device_code : '';
  if (!deviceCode) return sendError(res, 400, 'expired_token');
  const poll = pollDeviceToken(ctx.db, deviceCode, Date.now());
  switch (poll.kind) {
    case 'pending':
      return sendError(res, 400, 'authorization_pending');
    case 'slow_down':
      return sendError(res, 400, 'slow_down');
    case 'denied':
      return sendError(res, 400, 'access_denied');
    case 'expired':
      return sendError(res, 400, 'expired_token');
    case 'approved': {
      const { plaintext, tokenId } = issueApiKey(ctx.db, poll.accountId, poll.label);
      return sendJson(res, 200, { token: plaintext, tokenId, label: poll.label });
    }
  }
}
