import type { IncomingMessage, ServerResponse } from 'node:http';

import type { GatewayContext } from './context.js';
import { sendError } from './http.js';
import { authorize } from './policy.js';
import { resolvePrincipal } from './principal.js';
import { listSourceStores, type SourceStore } from './source-stores.js';
import { roster } from './stores.js';

/**
 * GET /v1/workspaces/:id/timeline
 * GET /v1/workspaces/:id/tasks
 *
 * Browser/API read surfaces (H060). The gateway only authenticates, applies
 * workspace membership ACL, and forwards to the internal headless replica.
 * Projection and event interpretation stay out of the gateway package — what
 * does happen here is control-plane LABELING (canvas chat grammar): each
 * item's `member` becomes the owning account's email, resolved through the
 * self-declared source-store registry first (client-synced events, whose raw
 * `member` is an agent actor like `codex`) and the roster second (replica-authored
 * events, whose raw `member` is an `acc_…` id). `writer` stays an agent label
 * inside the item; registered labels humanize `sourceProjectLabel`. Items whose
 * provenance resolves to nothing pass through unlabeled — the pre-provenance /
 * identity-divergence backlog is NOT guessed at here.
 */

export async function handleWorkspaceTimeline(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
  query: URLSearchParams,
): Promise<void> {
  const params = new URLSearchParams();
  const limit = query.get('limit');
  if (limit !== null) params.set('limit', limit);
  return forwardReplicaRead(req, res, ctx, storeId, 'timeline', params);
}

export async function handleWorkspaceTasks(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
): Promise<void> {
  return forwardReplicaRead(req, res, ctx, storeId, 'tasks', new URLSearchParams());
}

async function forwardReplicaRead(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  storeId: string,
  resource: 'timeline' | 'tasks',
  params: URLSearchParams,
): Promise<void> {
  const principal = resolvePrincipal(ctx, req);
  if (!principal) return sendError(res, 401, 'authentication required');

  const decision = authorize(ctx.db, principal, { kind: 'workspace', storeId }, 'read');
  if (!decision.ok) return sendError(res, decision.status, decision.error ?? 'forbidden');

  const qs = params.toString();
  const target =
    `${ctx.config.replicaUrl}/v1/workspaces/${encodeURIComponent(storeId)}/${resource}` +
    (qs ? `?${qs}` : '');

  let replicaRes: Response;
  try {
    replicaRes = await fetch(target, { method: 'GET' });
  } catch {
    return sendError(res, 502, 'replica unreachable');
  }

  let text = await replicaRes.text();
  if (replicaRes.ok) {
    text = labelMembers(
      text,
      new Map(roster(ctx.db, storeId).map((m) => [m.accountId, m.email])),
      new Map(listSourceStores(ctx.db, storeId).map((s) => [s.sourceProjectId, s])),
    );
  }
  res.writeHead(replicaRes.status, {
    'content-type': replicaRes.headers.get('content-type') ?? 'application/json',
  });
  res.end(text);
}

function labelMembers(
  raw: string,
  emailsByAccount: Map<string, string>,
  sources: Map<string, SourceStore>,
): string {
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
    const source =
      typeof row.sourceProjectId === 'string' ? sources.get(row.sourceProjectId) : undefined;
    // Source-store registration is the authoritative member resolution; the
    // account-id path only catches replica-authored items. Unresolvable rows
    // (unregistered legacy events) pass through with their raw member.
    const member =
      source?.email ?? (typeof row.member === 'string' ? emailsByAccount.get(row.member) : undefined);
    const writer = typeof row.writer === 'string' ? emailsByAccount.get(row.writer) : undefined;
    return {
      ...row,
      ...(member ? { member } : {}),
      ...(writer ? { writer } : {}),
      ...(source?.label ? { sourceProjectLabel: source.label } : {}),
    };
  });
  return JSON.stringify({ ...body, items });
}
