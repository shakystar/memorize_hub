import { createHash, randomBytes } from 'node:crypto';

/**
 * Participant API key crypto. A key is a high-entropy capability string the
 * participant presents as `Authorization: Bearer <key>`; the gateway stores
 * only its SHA-256 hash, never the plaintext. The key is shown exactly once,
 * at issuance.
 */

export interface GeneratedApiKey {
  /** Full secret — returned once to the participant, never persisted. */
  plaintext: string;
  /** SHA-256 hex of the plaintext — what we store and look up by. */
  hash: string;
  /** Non-secret leading slice, stored for display in listings. */
  prefix: string;
}

const KEY_PREFIX = 'mzk_';

/** SHA-256 hex of an API key plaintext. */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Mint a fresh project-scoped API key. */
export function generateApiKey(): GeneratedApiKey {
  const plaintext = KEY_PREFIX + randomBytes(32).toString('base64url');
  return {
    plaintext,
    hash: hashToken(plaintext),
    prefix: plaintext.slice(0, KEY_PREFIX.length + 6),
  };
}

/** Random id with a typed prefix, e.g. `tok_1a2b…`. */
export function newId(kind: 'usr' | 'tok' | 'req'): string {
  return `${kind}_${randomBytes(9).toString('base64url')}`;
}
