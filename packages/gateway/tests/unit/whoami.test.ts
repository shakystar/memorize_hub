import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import { issueApiKey } from '../../src/keys.js';
import { createGatewayServer } from '../../src/server.js';

/**
 * GET /v1/account identity echo (whoami). Admits every principal (scoped and
 * read-only included) because it discloses only the caller's own identity; the
 * H060 replica needs it to stamp the calling user's account as event `writer`.
 */

const db = openGatewayDb(':memory:');
const config = loadGatewayConfig({});
const server = createGatewayServer({ db, config });
let base = '';

const alice = upsertAccountByEmail(db, 'alice@whoami.example');
const plainKey = issueApiKey(db, alice, 'plain').plaintext;
const readOnlyKey = issueApiKey(db, alice, 'ro', { readOnly: true }).plaintext;
const scopedKey = issueApiKey(db, alice, 'scoped', {
  storeIds: ['wsp_whoami_test'],
}).plaintext;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  db.close();
});

function auth(key: string) {
  return { authorization: `Bearer ${key}` };
}

describe('GET /v1/account (whoami)', () => {
  it('401s without a principal', async () => {
    const res = await fetch(`${base}/v1/account`);
    expect(res.status).toBe(401);
  });

  it('echoes the key holder identity', async () => {
    const res = await fetch(`${base}/v1/account`, { headers: auth(plainKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.accountId).toBe(alice);
    expect(body.email).toBe('alice@whoami.example');
    expect(body.via).toBe('key');
    expect(body.readOnly).toBe(false);
    expect(body.scoped).toBe(false);
  });

  it('admits read-only and scoped keys, flagging the axes', async () => {
    const ro = (await (
      await fetch(`${base}/v1/account`, { headers: auth(readOnlyKey) })
    ).json()) as Record<string, unknown>;
    expect(ro.accountId).toBe(alice);
    expect(ro.readOnly).toBe(true);

    const scoped = (await (
      await fetch(`${base}/v1/account`, { headers: auth(scopedKey) })
    ).json()) as Record<string, unknown>;
    expect(scoped.accountId).toBe(alice);
    expect(scoped.scoped).toBe(true);
  });

  it('401s a garbage key', async () => {
    const res = await fetch(`${base}/v1/account`, {
      headers: auth('mzk_not_a_real_key'),
    });
    expect(res.status).toBe(401);
  });
});
