import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openGatewayDb } from '../../src/db.js';

describe('gateway control-plane db', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hub-gw-db-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('migrates a fresh db: creates the control-plane tables and bumps user_version', () => {
    const db = openGatewayDb(join(dir, 'gw.db'));
    try {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining(['users', 'api_tokens', 'project_acl', 'access_requests']),
      );
      expect(db.pragma('user_version', { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });

  it('is idempotent across reopen: data survives and user_version is stable', () => {
    const file = join(dir, 'gw.db');
    const first = openGatewayDb(file);
    first
      .prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .run('u1', 'a@example.com', '2026-06-25T00:00:00.000Z');
    first.close();

    const second = openGatewayDb(file);
    try {
      expect(second.pragma('user_version', { simple: true })).toBe(1);
      const row = second.prepare('SELECT email FROM users WHERE id = ?').get('u1') as
        | { email: string }
        | undefined;
      expect(row?.email).toBe('a@example.com');
    } finally {
      second.close();
    }
  });

  it('enforces unique email and api_token foreign key', () => {
    const db = openGatewayDb(':memory:');
    try {
      db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(
        'u1',
        'a@example.com',
        '2026-06-25T00:00:00.000Z',
      );
      expect(() =>
        db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(
          'u2',
          'a@example.com',
          '2026-06-25T00:00:00.000Z',
        ),
      ).toThrow(/UNIQUE/);

      // foreign_keys = ON → token referencing a missing user is rejected.
      expect(() =>
        db
          .prepare(
            'INSERT INTO api_tokens (id, user_id, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run('t1', 'ghost', 'hash', 'mzk_xxx', '2026-06-25T00:00:00.000Z'),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      db.close();
    }
  });
});
