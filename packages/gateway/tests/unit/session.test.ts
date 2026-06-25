import { describe, expect, it } from 'vitest';

import { operatorCookie, readOperator, signValue, verifyValue } from '../../src/session.js';

const SECRET = 'unit-secret';

describe('signed session values', () => {
  it('round-trips a signed value', () => {
    const token = signValue({ login: 'me', exp: Date.now() + 1000 }, SECRET);
    expect(verifyValue<{ login: string }>(token, SECRET)?.login).toBe('me');
  });

  it('rejects a tampered payload', () => {
    const token = signValue({ login: 'me', exp: Date.now() + 1000 }, SECRET);
    const [, mac] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ login: 'admin', exp: Date.now() + 1000 })).toString('base64url')}.${mac}`;
    expect(verifyValue(forged, SECRET)).toBeNull();
  });

  it('rejects a value signed with another secret', () => {
    const token = signValue({ login: 'me', exp: Date.now() + 1000 }, SECRET);
    expect(verifyValue(token, 'other-secret')).toBeNull();
  });

  it('rejects an expired value', () => {
    const token = signValue({ login: 'me', exp: Date.now() - 1 }, SECRET);
    expect(verifyValue(token, SECRET)).toBeNull();
  });

  it('reads an operator from its own cookie', () => {
    const setCookie = operatorCookie('operator-login', SECRET);
    const cookieHeader = setCookie.split(';')[0]!; // hub_op=<value>
    expect(readOperator(cookieHeader, SECRET)?.login).toBe('operator-login');
    expect(readOperator('hub_op=garbage', SECRET)).toBeNull();
  });
});
