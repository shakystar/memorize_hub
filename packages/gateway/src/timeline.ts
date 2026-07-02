import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayContext } from './context.js';
import { sendError } from './http.js';
import { authorize } from './policy.js';
import { resolvePrincipal } from './principal.js';
import { roster } from './stores.js';

/**
 * GET /v1/workspaces/:id/timeline
 *
 * Browser/API read surface for Timeline. The gateway only authenticates,
 * applies workspace membership ACL, and forwards to the internal headless
 * replica. Projection and event interpretation stay out of the gateway package.
 */
export async function handleWorkspaceTimeline(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
  query: URLSearchParams,
): Promise<void> {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');

  const decision = authorize(ctx.db, principal, { kind: 'workspace', storeId }, 'read');
  if (!decision.ok) return sendError(res, decision.status, decision.error ?? 'forbidden');

  const params = new URLSearchParams();
  const limit = query.get('limit');
  if (limit !== null) params.set('limit', limit);
  const qs = params.toString();
  const target =
    `${ctx.config.replicaUrl}/v1/workspaces/${encodeURIComponent(storeId)}/timeline` +
    (qs ? `?${qs}` : '');

  let replicaRes: Response;
  try {
    replicaRes = await fetch(target, { method: 'GET' });
  } catch {
    return sendError(res, 502, 'replica unreachable');
  }

  let text = await replicaRes.text();
  if (replicaRes.ok) {
    text = labelTimelineMembers(text, new Map(roster(ctx.db, storeId).map((m) => [m.accountId, m.email])));
  }
  res.writeHead(replicaRes.status, {
    'content-type': replicaRes.headers.get('content-type') ?? 'application/json',
  });
  res.end(text);
}

function labelTimelineMembers(raw: string, emailsByAccount: Map<string, string>): string {
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
  if (!body || typeof body !== 'object' || !Array.isArray((body as { items?: unknown }).items)) {
    return raw;
  }
  const items = (body as { items: unknown[] }).items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const row = item as Record<string, unknown>;
    const member = typeof row.member === 'string' ? emailsByAccount.get(row.member) : undefined;
    const writer = typeof row.writer === 'string' ? emailsByAccount.get(row.writer) : undefined;
    return {
      ...row,
      ...(member ? { member } : {}),
      ...(writer ? { writer } : {}),
    };
  });
  return JSON.stringify({ ...body, items });
}
