/**
 * End-to-end validation against a REAL memorize client (issue #2).
 *
 * Spawns the built relay (`dist/index.js`, token auth on) as a separate
 * process, then drives the sibling repo's built CLI as two replicas with
 * separate MEMORIZE_ROOTs ("machine A" / "machine B"):
 *
 *   A: project init + task create -> sync --push   (then re-push: dedup = 0)
 *   B: project clone <id>                          (events converge)
 *   B: task create -> sync --push
 *   A: sync --pull                                 (bidirectional converge)
 *
 * Convergence is asserted on the actual SQLite event logs (node:sqlite,
 * read-only) and the relay's on-disk ndjson — including the contract that
 * local `sync.*` bookkeeping never crosses the wire.
 *
 * Run: pnpm e2e   (requires ../memorize built: pnpm --dir ../memorize build)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HUB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// HUB_ROOT is the relay package dir (packages/relay); the sibling memorize repo
// lives three levels up at <monorepo>/../memorize.
const MEMORIZE_CLI =
  process.env.MEMORIZE_CLI ??
  resolve(HUB_ROOT, '..', '..', '..', 'memorize', 'dist', 'cli', 'index.js');
const TOKEN = 'e2e-secret';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code) => resolveRun({ code: code ?? -1, stdout, stderr }));
  });
}

async function cli(
  memorizeRoot: string,
  cwd: string,
  ...args: string[]
): Promise<string> {
  const result = await run(process.execPath, [MEMORIZE_CLI, ...args], {
    cwd,
    env: {
      MEMORIZE_ROOT: memorizeRoot,
      MEMORIZE_LLM_BACKEND: 'off',
    },
  });
  if (result.code !== 0) {
    throw new Error(
      `memorize ${args.join(' ')} exited ${result.code}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function eventRows(dbPath: string): { id: string; type: string; payload: string }[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare('SELECT id, type, payload FROM events ORDER BY seq')
      .all() as { id: string; type: string; payload: string }[];
  } finally {
    db.close();
  }
}

/** Replicated (non-local-bookkeeping) event ids — `sync.*` never syncs. */
const replicated = (rows: { id: string; type: string }[]): Set<string> =>
  new Set(rows.filter((row) => !row.type.startsWith('sync.')).map((row) => row.id));

async function waitForHealthz(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('relay did not become healthy in 10s');
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 100));
  }
}

const sandbox = await mkdtemp(join(tmpdir(), 'hub-e2e-'));
const storeDir = join(sandbox, 'relay-store');
const homeA = join(sandbox, 'home-a');
const homeB = join(sandbox, 'home-b');
const projectDirA = join(sandbox, 'proj-a');
const projectDirB = join(sandbox, 'proj-b');
await Promise.all(
  [homeA, homeB, projectDirA, projectDirB].map((dir) =>
    mkdir(dir, { recursive: true }),
  ),
);

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const relay: ChildProcess = spawn(
  process.execPath,
  [join(HUB_ROOT, 'dist', 'index.js')],
  {
    cwd: HUB_ROOT,
    env: {
      ...process.env,
      MEMORIZE_RELAY_PORT: String(port),
      MEMORIZE_RELAY_STORE: storeDir,
      MEMORIZE_RELAY_TOKEN: TOKEN,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);

try {
  await waitForHealthz(baseUrl);
  console.log(`relay up at ${baseUrl} (cli: ${MEMORIZE_CLI})\n`);

  // Auth gate sanity from the outside.
  const unauthorized = await fetch(`${baseUrl}/healthz`);
  check('relay rejects missing token with 401', unauthorized.status === 401);

  // --- Machine A: create, work, push ---
  const initOut = await cli(homeA, projectDirA, 'project', 'init');
  const projectId = /\(([^)]+)\)\s*$/.exec(initOut)?.[1];
  if (!projectId) throw new Error(`could not parse project id from: ${initOut}`);
  console.log(`projectId: ${projectId}`);

  await cli(homeA, projectDirA, 'task', 'create', 'E2E', 'task', 'from', 'A');

  const pushOut = await cli(
    homeA, projectDirA,
    'project', 'sync', '--push', '--remote-url', baseUrl, '--token', TOKEN,
  );
  const pushedCount = Number(/Pushed (\d+) events/.exec(pushOut)?.[1] ?? -1);
  check('A pushes its events', pushedCount > 0, pushOut);

  const repushOut = await cli(
    homeA, projectDirA,
    'project', 'sync', '--push', '--remote-url', baseUrl, '--token', TOKEN,
  );
  check('re-push is a no-op (idempotent dedup)', /Pushed 0 events/.test(repushOut), repushOut);

  // --- Relay disk: opaque ndjson, no local bookkeeping on the wire ---
  const ndjson = (await readFile(join(storeDir, projectId, 'events.ndjson'), 'utf8'))
    .trim().split('\n').map((line) => JSON.parse(line) as { id: string; type: string });
  check('relay ndjson line count == accepted push count', ndjson.length === pushedCount,
    `${ndjson.length} lines vs ${pushedCount} pushed`);
  check('sync.* bookkeeping never crosses the wire',
    ndjson.every((event) => !event.type.startsWith('sync.')));

  // --- Machine B: clone, verify convergence ---
  const cloneOut = await cli(
    homeB, projectDirB,
    'project', 'clone', projectId, '--remote-url', baseUrl, '--token', TOKEN,
  );
  check('B clones with events pulled', /\(\d+ events pulled\)/.test(cloneOut), cloneOut);

  const dbA = join(homeA, 'projects', projectId, 'memorize.db');
  const dbB = join(homeB, 'projects', projectId, 'memorize.db');
  const idsA1 = replicated(eventRows(dbA));
  const idsB1 = replicated(eventRows(dbB));
  check('A and B hold the same replicated event set after clone',
    idsA1.size === idsB1.size && [...idsA1].every((id) => idsB1.has(id)),
    `A=${idsA1.size} B=${idsB1.size}`);

  // --- Bidirectional: B works, pushes; A pulls ---
  await cli(homeB, projectDirB, 'task', 'create', 'E2E', 'task', 'from', 'B');
  const pushBOut = await cli(
    homeB, projectDirB,
    'project', 'sync', '--push', '--remote-url', baseUrl, '--token', TOKEN,
  );
  check('B pushes its new event', !/Pushed 0 events/.test(pushBOut), pushBOut);

  const pullAOut = await cli(
    homeA, projectDirA,
    'project', 'sync', '--pull', '--remote-url', baseUrl, '--token', TOKEN,
  );
  check('A pulls B\'s event as new', /\([1-9]\d* new/.test(pullAOut), pullAOut);

  const rowsA2 = eventRows(dbA);
  const idsA2 = replicated(rowsA2);
  const idsB2 = replicated(eventRows(dbB));
  check('A and B converge after bidirectional sync',
    idsA2.size === idsB2.size && [...idsA2].every((id) => idsB2.has(id)),
    `A=${idsA2.size} B=${idsB2.size}`);
  check('A sees the task created on B',
    rowsA2.some((row) => row.type === 'task.created' && row.payload.includes('E2E task from B')));
  check('exactly one project.created survives on A',
    rowsA2.filter((row) => row.type === 'project.created').length === 1);

  console.log(failures === 0 ? '\nE2E PASS' : `\nE2E FAIL (${failures} failed checks)`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  relay.kill();
  await once(relay, 'exit').catch(() => undefined);
  await rm(sandbox, { recursive: true, force: true });
}
