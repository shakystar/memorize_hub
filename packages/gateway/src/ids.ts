import { createHash, randomBytes } from 'node:crypto';

/**
 * Identifiers and key crypto (Hub SoT H050, docs/protocol/README.md §1).
 *
 * Every *remote store* id is server-minted here — the gateway is the sole minter
 * of `psm_`/`wsp_`/`inv_`/`acc_`/`tok_`. The client's own `proj_…` is never a
 * path id; it rides inside events as `sourceProjectId` provenance.
 */

/** Server-minted id namespaces. `req_` (legacy access-request) is retired (H080). */
export type IdKind = 'acc' | 'tok' | 'wsp' | 'inv' | 'psm';

/** Random id with a typed prefix, e.g. `wsp_1a2b…`. */
export function newId(kind: IdKind): string {
  return `${kind}_${randomBytes(9).toString('base64url')}`;
}

/**
 * Shared path-id contract with the relay: the id becomes a filesystem path
 * component, so this also closes path traversal. Every server-minted store id
 * conforms by construction (docs/protocol/README.md §1).
 */
export const STORE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidStoreId(id: string): boolean {
  return STORE_ID_PATTERN.test(id);
}

const PERSONAL_STORE_PREFIX = 'psm_';
const WORKSPACE_STORE_PREFIX = 'wsp_';
const INVITE_PREFIX = 'inv_';

export function isPersonalStoreId(id: string): boolean {
  return id.startsWith(PERSONAL_STORE_PREFIX);
}

export function isWorkspaceStoreId(id: string): boolean {
  return id.startsWith(WORKSPACE_STORE_PREFIX);
}

/**
 * Reserved namespaces the gateway refuses to reinterpret: a store's kind is fixed
 * at mint time, so a `psm_`/`wsp_`/`inv_`-shaped id is never granted, cloned, or
 * requested as a plain project (docs/protocol/README.md §1).
 */
export function isReservedId(id: string): boolean {
  return (
    id.startsWith(PERSONAL_STORE_PREFIX) ||
    id.startsWith(WORKSPACE_STORE_PREFIX) ||
    id.startsWith(INVITE_PREFIX)
  );
}

/* ------------------------------------------------------------------ keys --- */

const KEY_PREFIX = 'mzk_';

export interface GeneratedApiKey {
  /** Full secret — returned once to the participant, never persisted. */
  plaintext: string;
  /** SHA-256 hex of the plaintext — what we store and look up by. */
  hash: string;
  /** Non-secret leading slice, stored for display in listings. */
  prefix: string;
}

/** SHA-256 hex of a secret (API key plaintext or invite token). */
export function hashSecret(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Mint a fresh account API key. */
export function generateApiKey(): GeneratedApiKey {
  const plaintext = KEY_PREFIX + randomBytes(32).toString('base64url');
  return {
    plaintext,
    hash: hashSecret(plaintext),
    prefix: plaintext.slice(0, KEY_PREFIX.length + 6),
  };
}

/** Mint a fresh invite token (a join capability/locator, not a durable secret). */
export function generateInviteToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(24).toString('base64url');
  return { plaintext, hash: hashSecret(plaintext) };
}
