import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createHttpSyncTransport } from '@shakystar/memorize/dist/adapters/sync-transport-http.js';
import { CURRENT_SCHEMA_VERSION, createId } from '@shakystar/memorize/dist/domain/common.js';
import type { ProjectSyncState } from '@shakystar/memorize/dist/domain/entities.js';
import { pushProject } from '@shakystar/memorize/dist/services/sync-service.js';
import { appendEvent } from '@shakystar/memorize/dist/storage/event-store.js';
import { readJson, writeJson } from '@shakystar/memorize/dist/storage/fs-utils.js';
import { getProjectRoot, getSyncFile } from '@shakystar/memorize/dist/storage/path-resolver.js';

/**
 * H060 S1 on-demand authoring (deployment form A).
 *
 * The replica is a thin host around the published memorize engine: it authors
 * one domain event into a server-side memorize store bound to the workspace,
 * pushes it over the same public events route every client uses, and exits.
 * Zero new domain logic lives here.
 *
 * Identity model: the replica has no identity of its own. Every write is
 * authored as the calling user. `writer` is the caller's account, resolved via
 * `GET /v1/account` whoami with the caller's own key. `actor` is `user`, a
 * human edit. Authorization is the caller's key passing the ordinary member ACL
 * on the events route; the replica holds no privileged path.
 *
 * Lane model: one server-side store per workspace, deterministically derived
 * from the `wsp_` id so every on-demand run reuses the same lane. All web
 * authors share this one lane; the per-person axis is `writer`.
 *
 * Whitelist: S1 authors exactly one event type, `memory.consolidated`
 * (add memory). Salience comes from the caller; the Hub runs no LLM.
 */

const VALID_KINDS = ['decision', 'rationale', 'progress'] as const;
export type AuthorMemoryKind = (typeof VALID_KINDS)[number];

export interface AuthorMemoryParams {
  /** Public gateway base URL, the same edge clients use. */
  hubUrl: string;
  /** The calling user's API key: authz and provenance identity. */
  apiKey: string;
  /** Server-minted workspace store id (`wsp_...`). */
  workspaceId: string;
  item: { kind: AuthorMemoryKind; text: string; salience: number };
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface AuthorMemoryResult {
  memoryId: string;
  eventId: string;
  /** The account the event was authored as (provenance `writer`). */
  accountId: string;
  /** The server-side store lane the event lives in. */
  storeId: string;
  /** Events newly accepted by the Hub on this push. */
  accepted: number;
}

/**
 * Deterministic per-workspace server store id: the stable "web" lane.
 *
 * Gateway `wsp_` ids are base62 and may contain uppercase letters, but the
 * embedded memorize engine only accepts lowercase local project ids. Keep
 * already-valid suffixes readable for tests/dev, and hex-encode real mixed-case
 * workspace ids into a collision-free lowercase lane id.
 */
export function serverStoreId(workspaceId: string): string {
  if (!workspaceId.startsWith('wsp_')) {
    throw new Error(`workspaceId must be a server-minted wsp_ id, got: ${workspaceId}`);
  }
  const suffix = workspaceId.slice('wsp_'.length);
  if (/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(suffix)) return `proj_hub_${suffix}`;
  return `proj_hub_${Buffer.from(workspaceId, 'utf8').toString('hex')}`;
}

/** Resolve the caller's key to its account via the whoami endpoint. */
async function whoami(
  hubUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const base = hubUrl.replace(/\/+$/, '');
  const res = await fetchImpl(`${base}/v1/account`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`whoami failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as { accountId?: string; readOnly?: boolean };
  if (!body.accountId) throw new Error('whoami returned no accountId');
  if (body.readOnly) {
    throw new Error('this key is read-only; authoring needs a writable key');
  }
  return body.accountId;
}

/**
 * Author one memory into the workspace as the calling user, push, and return.
 * Requires MEMORIZE_ROOT to point at the replica's server-side root; the
 * embedded engine resolves every path through it.
 */
export async function authorMemory(
  params: AuthorMemoryParams,
): Promise<AuthorMemoryResult> {
  if (!process.env.MEMORIZE_ROOT) {
    throw new Error('MEMORIZE_ROOT must be set to the replica server root');
  }
  const { kind, text, salience } = params.item;
  if (!VALID_KINDS.includes(kind)) {
    throw new Error(`kind must be one of ${VALID_KINDS.join('|')}, got: ${kind}`);
  }
  if (!text.trim()) throw new Error('text must be non-empty');
  if (!Number.isInteger(salience) || salience < 1 || salience > 10) {
    throw new Error(`salience must be an integer 1..10, got: ${salience}`);
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const accountId = await whoami(params.hubUrl, params.apiKey, fetchImpl);
  const storeId = serverStoreId(params.workspaceId);
  const now = new Date().toISOString();

  // First touch of this workspace's lane: give the server store a genesis so it
  // is a coherent memorize store like any other union writer's.
  const isNewStore = !existsSync(join(getProjectRoot(storeId), 'memorize.db'));
  if (isNewStore) {
    await appendEvent({
      type: 'project.created',
      projectId: storeId,
      scopeType: 'project',
      scopeId: storeId,
      actor: 'user',
      writer: accountId,
      payload: {
        id: storeId,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        title: 'Hub web edits',
        summary: `Server-side authoring lane for ${params.workspaceId} (H060 S1)`,
        goals: [],
        status: 'active',
        rootPath: `hub://${params.workspaceId}`,
        activeWorkstreamIds: [],
        activeTaskIds: [],
        acceptedDecisionIds: [],
        ruleIds: [],
      } as never,
    });
  }

  const memoryId = createId('mem');
  const event = await appendEvent({
    type: 'memory.consolidated',
    projectId: storeId,
    scopeType: 'project',
    scopeId: storeId,
    actor: 'user',
    writer: accountId,
    payload: {
      id: memoryId,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      projectId: storeId,
      kind,
      text: text.trim(),
      salience,
      sourceObservationIds: [],
      importSource: 'hub-web',
    } as never,
  });

  const syncFile = getSyncFile(storeId);
  const existingState = await readJson<ProjectSyncState>(syncFile);
  const bindingPatch = {
    remoteProjectId: params.workspaceId,
    syncEnabled: true,
    syncTransport: { type: 'http' as const, url: params.hubUrl },
    updatedAt: now,
  };
  await writeJson(
    syncFile,
    existingState
      ? { ...existingState, ...bindingPatch }
      : {
          id: `sync_${storeId}`,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          createdAt: now,
          projectId: storeId,
          syncStatus: 'idle' as const,
          ...bindingPatch,
        },
  );

  const response = await pushProject(
    storeId,
    createHttpSyncTransport(params.hubUrl, {
      token: params.apiKey,
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    }),
  );

  return {
    memoryId,
    eventId: event.id,
    accountId,
    storeId,
    accepted: response.accepted.length,
  };
}
