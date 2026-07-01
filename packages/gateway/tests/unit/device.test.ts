import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { upsertAccountByEmail } from '../../src/accounts.js';
import { loadGatewayConfig } from '../../src/config.js';
import { openGatewayDb } from '../../src/db.js';
import {
  approveDevice,
  findPendingByUserCode,
  normalizeUserCode,
  pollDeviceToken,
  startDeviceAuth,
} from '../../src/device.js';
import { identifyToken } from '../../src/keys.js';
import { createGatewayServer } from '../../src/server.js';

/**
 * Device Authorization Grant (RFC 8628, docs/protocol/device-auth.md): the state
 * machine (pending -> approved -> collected/expired, slow_down pacing) plus the
 * two unauthenticated JSON endpoints. `nowMs` is injected so expiry/pacing are
 * deterministic without real waits.
 */

const config = loadGatewayConfig({ GATEWAY_PUBLIC_URL: 'https://hub.example' });

describe('device authorization grant', () => {
  it('normalizeUserCode uppercases, strips separators, regroups', () => {
    expect(normalizeUserCode('wdjb-mjht')).toBe('WDJB-MJHT');
    expect(normalizeUserCode('wdjbmjht')).toBe('WDJB-MJHT');
    expect(normalizeUserCode(' wd jb-mj ht ')).toBe('WDJB-MJHT');
  });

  it('start -> approve -> approved poll mints once, then reads expired', () => {
    const db = openGatewayDb(':memory:');
    const acc = upsertAccountByEmail(db, 'u@e.com');
    const t0 = 1_000_000;

    const grant = startDeviceAuth(db, config, t0);
    expect(grant.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(grant.verification_uri).toBe('https://hub.example/device');
    expect(grant.verification_uri_complete).toContain(encodeURIComponent(grant.user_code));
    expect(grant.expires_in).toBe(600);

    // pending before approval; the approval page can find it
    expect(pollDeviceToken(db, grant.device_code, t0 + 1).kind).toBe('pending');
    expect(findPendingByUserCode(db, grant.user_code, t0 + 2)?.userCode).toBe(grant.user_code);

    // approve, then a too-soon poll is paced out
    expect(approveDevice(db, grant.user_code, acc, t0 + 3)).toBe(true);
    expect(pollDeviceToken(db, grant.device_code, t0 + 4).kind).toBe('slow_down');

    // after the interval, the approved poll returns the account and consumes the row
    const collected = pollDeviceToken(db, grant.device_code, t0 + 6000);
    expect(collected.kind).toBe('approved');
    if (collected.kind === 'approved') expect(collected.accountId).toBe(acc);
    expect(pollDeviceToken(db, grant.device_code, t0 + 7000).kind).toBe('expired');

    db.close();
  });

  it('expires after the 10-minute TTL', () => {
    const db = openGatewayDb(':memory:');
    const grant = startDeviceAuth(db, config, 0);
    expect(pollDeviceToken(db, grant.device_code, 700_000).kind).toBe('expired');
    expect(findPendingByUserCode(db, grant.user_code, 700_000)).toBeNull();
    db.close();
  });

  it('unknown device_code reads as expired (no existence leak)', () => {
    const db = openGatewayDb(':memory:');
    expect(pollDeviceToken(db, 'no-such-code', 1).kind).toBe('expired');
    db.close();
  });

  it('cannot approve an unknown or expired code', () => {
    const db = openGatewayDb(':memory:');
    const acc = upsertAccountByEmail(db, 'u@e.com');
    expect(approveDevice(db, 'ZZZZ-ZZZZ', acc, 1)).toBe(false);
    db.close();
  });

  it('HTTP: pending poll, and a fresh approved grant mints a usable key', async () => {
    const db = openGatewayDb(':memory:');
    const acc = upsertAccountByEmail(db, 'u@e.com');
    const server = createGatewayServer({ db, config });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const json = (body: unknown): RequestInit => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const start = async () =>
      (await (await fetch(`${base}/v1/device/code`, { method: 'POST' })).json()) as {
        device_code: string;
        user_code: string;
      };

    // Grant A: an unapproved poll is pending.
    const a = await start();
    const pending = await fetch(`${base}/v1/device/token`, json({ device_code: a.device_code }));
    expect(pending.status).toBe(400);
    expect(((await pending.json()) as { error: string }).error).toBe('authorization_pending');

    // Grant B: approve (simulated browser), then its FIRST poll collects — no prior
    // poll, so no slow_down — minting a key that resolves to the account.
    const b = await start();
    expect(approveDevice(db, b.user_code, acc, Date.now())).toBe(true);
    const tokRes = await fetch(`${base}/v1/device/token`, json({ device_code: b.device_code }));
    expect(tokRes.status).toBe(200);
    const { token } = (await tokRes.json()) as { token: string };
    expect(identifyToken(db, token)?.accountId).toBe(acc);

    server.close();
    db.close();
  });
});
