import { CURRENT_SCHEMA_VERSION } from '@shakystar/memorize/dist/domain/common.js';
import type { ProjectSyncState } from '@shakystar/memorize/dist/domain/entities.js';
import { readJson, writeJson } from '@shakystar/memorize/dist/storage/fs-utils.js';
import { getSyncFile } from '@shakystar/memorize/dist/storage/path-resolver.js';

/**
 * Deterministic per-workspace server store id: the stable Hub web/replica lane.
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

export interface BindWorkspaceStoreParams {
  storeId: string;
  workspaceId: string;
  hubUrl: string;
  now?: string;
}

/**
 * Bind a local memorize store to the opaque server-minted workspace id.
 *
 * This writes the sync file directly, preserving watermarks when present. It
 * deliberately does not call updateSyncState because this binding is setup
 * metadata; pull/push will append normal sync.state.updated events.
 */
export async function bindWorkspaceStore(
  params: BindWorkspaceStoreParams,
): Promise<ProjectSyncState> {
  const now = params.now ?? new Date().toISOString();
  const syncFile = getSyncFile(params.storeId);
  const existingState = await readJson<ProjectSyncState>(syncFile);
  const bindingPatch = {
    remoteProjectId: params.workspaceId,
    syncEnabled: true,
    syncTransport: { type: 'http' as const, url: params.hubUrl },
    updatedAt: now,
  };
  const next = existingState
    ? { ...existingState, ...bindingPatch }
    : {
        id: `sync_${params.storeId}`,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: now,
        projectId: params.storeId,
        syncStatus: 'idle' as const,
        ...bindingPatch,
      };
  await writeJson(syncFile, next);
  return next;
}
