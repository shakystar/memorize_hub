/**
 * End-to-end: two memorize replicas converge THROUGH the gateway on one PC.
 *
 * This is the automated form of the local two-replica test — run the Hub
 * locally, point two memorize homes (MEMORIZE_ROOT = "machine A" / "machine B")
 * at it, and watch events converge over the network path:
 *
 *   memorize CLI ──HTTP──▶ gateway (API-key auth + ACL) ──HTTP+token──▶ relay
 *
 *   A: project init → operator approves (mint project-scoped key) → push
 *   B: project clone <id> with the SAME key                      → converge
 *   measures push→clone convergence latency; asserts cross-project 403.
 *
 * Both relay and gateway run in-process (no build needed); the only external
 * dependency is the sibling memorize CLI. Run: pnpm e2e:gateway
 *   (requires ../../../memorize built, or set MEMORIZE_CLI)
 */
import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRelayServer } from '../../../relay/src/server.js';
import { EventStore } from '../../../relay/src/store.js';
import { openGatewayDb } from '../../src/db.js';
import { createGatewayServer } from '../../src/server.js';
import { grantProjectAccess, issueApiKey, upsertUser } from '../../src/store.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MONO_ROOT = resolve(HERE, '..', '..', '..', '..');
const MEMORIZE_CLI =
  process.env.MEMORIZE_CLI ??
  resolve(MONO_ROOT, '..', 'memorize', 'dist', 'cli', 'index.js');
const RELAY_TOKEN = 'gw-e2e-relay-secret';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function listen(server: Server): Promise<number> {
  return new Promise((res) =>
    server.listen(0, '127.0.0.1', () => res((server.address() as AddressInfo).port)),
  );
}

function cli(memorizeRoot: string, cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [MEMORIZE_CLI, ...args], {
      cwd,
      env: { ...process.env, MEMORIZE_ROOT: memorizeRoot, MEMORIZE_LLM_BACKEND: 'off' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolveRun(out.trim())
        : reject(new Error(`memorize ${args.join(' ')} exited ${code}\n${out}${err}`)),
    );
  });
}

const sandbox = await mkdtemp(join(tmpdir(), 'hub-gw-e2e-'));
const homeA = join(sandbox, 'home-a');
const homeB = join(sandbox, 'home-b');
const projA = join(sandbox, 'proj-a');
const projB = join(sandbox, 'proj-b');
await Promise.all([homeA, homeB, projA, projB].map((d) => mkdir(d, { recursive: true })));

const store = await EventStore.open(join(sandbox, 'relay-store'));
const relay = createRelayServer({ store, token: RELAY_TOKEN });
const relayPort = await listen(relay);

const db = openGatewayDb(join(sandbox, 'gateway.db'));
const gateway = createGatewayServer({
  db,
  config: {
    port: 0,
    dbFile: join(sandbox, 'gateway.db'),
    relayUrl: `http://127.0.0.1:${relayPort}`,
    relayToken: RELAY_TOKEN,
    publicUrl: undefined,
  },
});
const gatewayUrl = `http://127.0.0.1:${await listen(gateway)}`;

try {
  const health = await fetch(`${gatewayUrl}/healthz`);
  check('gateway healthz is public', health.status === 200);
  console.log(`gateway up at ${gatewayUrl} → relay :${relayPort} (cli: ${MEMORIZE_CLI})\n`);

  // --- Machine A: create a project locally ---
  const initOut = await cli(homeA, projA, 'project', 'init');
  const projectId = /\(([^)]+)\)\s*$/.exec(initOut)?.[1];
  if (!projectId) throw new Error(`could not parse project id from: ${initOut}`);
  console.log(`projectId: ${projectId}`);

  // --- Operator approves: mint a key scoped to THIS project ---
  const userId = upsertUser(db, 'beta@example.com');
  grantProjectAccess(db, userId, projectId);
  const apiKey = issueApiKey(db, userId, 'beta').plaintext;
  console.log(`issued project-scoped key ${apiKey.slice(0, 12)}…\n`);

  // --- A pushes through the gateway ---
  await cli(homeA, projA, 'task', 'create', 'Gateway', 'E2E', 'from', 'A');
  const t0 = Date.now();
  const pushOut = await cli(
    homeA, projA,
    'project', 'sync', '--push', '--remote-url', gatewayUrl, '--token', apiKey,
  );
  check('A pushes through the gateway', /Pushed [1-9]\d* events/.test(pushOut), pushOut);

  // --- B clones through the gateway with the same key (origin now idle) ---
  const cloneOut = await cli(
    homeB, projB,
    'project', 'clone', projectId, '--remote-url', gatewayUrl, '--token', apiKey,
  );
  const convergenceMs = Date.now() - t0;
  check('B clones and pulls events through the gateway', /\([1-9]\d* events pulled\)/.test(cloneOut), cloneOut);
  console.log(`async push→clone convergence: ${convergenceMs} ms`);

  // --- The key is scoped: a different project is refused at the edge ---
  const forbidden = await fetch(`${gatewayUrl}/v1/projects/proj_someone_else/events`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  check('cross-project request is refused (403) at the gateway', forbidden.status === 403);

  // --- An unissued key cannot sync at all ---
  const unauthorized = await fetch(`${gatewayUrl}/v1/projects/${projectId}/events`, {
    headers: { authorization: 'Bearer mzk_bogus' },
  });
  check('unissued key is rejected (401)', unauthorized.status === 401);

  console.log(failures === 0 ? '\nGATEWAY E2E PASS' : `\nGATEWAY E2E FAIL (${failures} failed checks)`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await new Promise<void>((res) => gateway.close(() => res()));
  await new Promise<void>((res) => relay.close(() => res()));
  db.close();
  await rm(sandbox, { recursive: true, force: true });
}
