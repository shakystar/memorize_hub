import { afterAll, describe, expect, it } from 'vitest';

import { openGatewayDb } from '../../src/db.js';
import { upsertAccountByEmail } from '../../src/accounts.js';
import { getOrCreateDerivedStore } from '../../src/derived-stores.js';
import { getOrCreatePersonalStore } from '../../src/personal-store.js';
import type { Principal } from '../../src/principal.js';
import { authorize } from '../../src/policy.js';
import { createStore } from '../../src/stores.js';

const db = openGatewayDb(':memory:');
afterAll(() => db.close());

const owner = upsertAccountByEmail(db, 'owner@derived.example');
const outsider = upsertAccountByEmail(db, 'outsider@derived.example');
const { storeId: wsp } = createStore(db, owner, 'parent');
const wspDerived = getOrCreateDerivedStore(db, wsp, 'embedding').storeId;
const psm = getOrCreatePersonalStore(db, owner).storeId;
const psmDerived = getOrCreateDerivedStore(db, psm, 'embedding').storeId;

function principal(accountId: string, over: Partial<Principal> = {}): Principal {
  return { accountId, via: 'key', readOnly: false, scoped: false, ...over };
}

describe('authorize() derived-store parent delegation', () => {
  it('mirrors a wsp_ parent: member may read+write its sidecar', () => {
    expect(authorize(db, principal(owner), { kind: 'store', storeId: wspDerived }, 'read').ok).toBe(true);
    expect(authorize(db, principal(owner), { kind: 'store', storeId: wspDerived }, 'write').ok).toBe(true);
  });

  it('mirrors a wsp_ parent: a non-member is denied the sidecar', () => {
    const d = authorize(db, principal(outsider), { kind: 'store', storeId: wspDerived }, 'read');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
  });

  it('mirrors a psm_ parent: owner allowed, others denied', () => {
    expect(authorize(db, principal(owner), { kind: 'store', storeId: psmDerived }, 'read').ok).toBe(true);
    expect(authorize(db, principal(outsider), { kind: 'store', storeId: psmDerived }, 'read').ok).toBe(false);
  });

  it('inherits read-only narrowing from the top gate', () => {
    const d = authorize(db, principal(owner, { readOnly: true }), { kind: 'store', storeId: wspDerived }, 'write');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
  });

  it('denies an unregistered der_ id (unknown parent)', () => {
    const d = authorize(db, principal(owner), { kind: 'store', storeId: 'der_unknown' }, 'read');
    expect(d.ok).toBe(false);
    expect(d.status).toBe(403);
  });
});
