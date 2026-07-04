import { afterAll, describe, expect, it } from 'vitest';

import { openGatewayDb } from '../../src/db.js';
import {
  deleteDerivedStores,
  getDerivedStoreParent,
  getOrCreateDerivedStore,
  isArtifactKind,
} from '../../src/derived-stores.js';
import { upsertAccountByEmail } from '../../src/accounts.js';
import { createStore, deleteStore } from '../../src/stores.js';

const db = openGatewayDb(':memory:');

afterAll(() => db.close());

describe('derived_stores migration', () => {
  it('bumps user_version to 6 (v6 appended)', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(6);
  });
});

describe('artifact-kind allowlist', () => {
  it('accepts embedding, rejects unknown', () => {
    expect(isArtifactKind('embedding')).toBe(true);
    expect(isArtifactKind('bogus')).toBe(false);
  });
});

describe('getOrCreateDerivedStore', () => {
  it('mints a der_ store bound to (parent, kind)', () => {
    const { storeId } = getOrCreateDerivedStore(db, 'wsp_parentA', 'embedding');
    expect(storeId.startsWith('der_')).toBe(true);
  });

  it('is idempotent for the same (parent, kind)', () => {
    const a = getOrCreateDerivedStore(db, 'wsp_parentB', 'embedding').storeId;
    const b = getOrCreateDerivedStore(db, 'wsp_parentB', 'embedding').storeId;
    expect(a).toBe(b);
  });

  it('gives distinct stores for distinct kinds under one parent', () => {
    const emb = getOrCreateDerivedStore(db, 'wsp_parentC', 'embedding').storeId;
    const fts = getOrCreateDerivedStore(db, 'wsp_parentC', 'fts-blob').storeId;
    expect(emb).not.toBe(fts);
  });
});

describe('getDerivedStoreParent', () => {
  it('resolves a der_ id to its parent binding', () => {
    const { storeId } = getOrCreateDerivedStore(db, 'wsp_parentD', 'embedding');
    expect(getDerivedStoreParent(db, storeId)).toEqual({
      parentStoreId: 'wsp_parentD',
      artifactKind: 'embedding',
    });
  });

  it('returns null for an unknown id', () => {
    expect(getDerivedStoreParent(db, 'der_nope')).toBeNull();
  });
});

describe('deleteDerivedStores', () => {
  it('removes every sidecar binding of a parent', () => {
    const { storeId } = getOrCreateDerivedStore(db, 'wsp_parentE', 'embedding');
    deleteDerivedStores(db, 'wsp_parentE');
    expect(getDerivedStoreParent(db, storeId)).toBeNull();
  });
});

describe('deleteStore cascade', () => {
  it("drops the parent store's sidecar bindings", () => {
    const owner = upsertAccountByEmail(db, 'teardown@derived.example');
    const { storeId: parent } = createStore(db, owner, 'to-delete');
    const der = getOrCreateDerivedStore(db, parent, 'embedding').storeId;
    deleteStore(db, parent);
    expect(getDerivedStoreParent(db, der)).toBeNull();
  });
});
