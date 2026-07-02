/**
 * H060 S1 verification: a bound replica converges from the authored event.
 *
 * Boots the real relay + gateway from dist, provisions a user, then:
 *
 *   user machine:  project init + auth login + workspace create
 *   replica:       hub-replica author-memory (as the user, via HUB_API_KEY)
 *   user machine:  project sync --pull
 *
 * PASS means the authored event converges into the user's local store carrying
 * `writer` = the user's account and the deterministic server lane
 * (`proj_hub_<encoded-wsp>`), so web writes are ordinary union writers.
 *
 * Run: pnpm e2e
 * Requires sibling builds: relay + gateway dist (pnpm -r build) and the
 * memorize CLI (MEMORIZE_CLI env, default ../memorize/dist/cli/index.js).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { glob, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HUB_ROOT = resolve(PKG_ROOT, '..', '..');
const RELAY_DIST = join(HUB_ROOT, 'packages', 'relay', 'dist', 'index.js');
const GATEWAY_DIST = join(HUB_ROOT, 'packages', 'gateway', 'dist', 'index.js');
const REPLICA_CLI = join(PKG_ROOT, 'dist', 'cli.js');
const MEMORIZE_CLI =
  process.env.MEMORIZE_CLI ??
  resolve(HUB_ROOT, '..', 'memorize', 'dist', 'cli', 'index.js');
const RELAY_TOKEN = 'replica-e2e-secret';

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
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
    env: { MEMORIZE_ROOT: memorizeRoot, MEMORIZE_LLM_BACKEND: 'off' },
  });
  if (result.code !== 0) {
    throw new Error(
      `memorize ${args.join(' ')} exited ${result.code}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function waitFor(url: string, headers: Record<string, string>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${label} did not become healthy in 15s`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const sandbox = await mkdtemp(join(tmpdir(), 'replica-e2e-'));
const relayStore = join(sandbox, 'relay-store');
const gatewayDb = join(sandbox, 'gateway.db');
const userHome = join(sandbox, 'user-home');
const userProj = join(sandbox, 'user-proj');
const replicaRoot = join(sandbox, 'replica-root');
await Promise.all(
  [userHome, userProj, replicaRoot].map((dir) => mkdir(dir, { recursive: true })),
);

const { openGatewayDb } = (await import(
  pathToFileURL(join(HUB_ROOT, 'packages/gateway/dist/db.js')).href
)) as typeof import('../../../gateway/src/db.js');
const { upsertAccountByEmail } = (await import(
  pathToFileURL(join(HUB_ROOT, 'packages/gateway/dist/accounts.js')).href
)) as typeof import('../../../gateway/src/accounts.js');
const { issueApiKey } = (await import(
  pathToFileURL(join(HUB_ROOT, 'packages/gateway/dist/keys.js')).href
)) as typeof import('../../../gateway/src/keys.js');
const db = openGatewayDb(gatewayDb);
const aliceAccount = upsertAccountByEmail(db, 'alice@replica.e2e');
const aliceKey = issueApiKey(db, aliceAccount, 'alice-e2e').plaintext;
db.close();

const relayPort = await freePort();
const gwPort = await freePort();
const relayUrl = `http://127.0.0.1:${relayPort}`;
const gwUrl = `http://127.0.0.1:${gwPort}`;

const relay: ChildProcess = spawn(process.execPath, [RELAY_DIST], {
  env: {
    ...process.env,
    MEMORIZE_RELAY_PORT: String(relayPort),
    MEMORIZE_RELAY_STORE: relayStore,
    MEMORIZE_RELAY_TOKEN: RELAY_TOKEN,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const gateway: ChildProcess = spawn(process.execPath, [GATEWAY_DIST], {
  env: {
    ...process.env,
    GATEWAY_PORT: String(gwPort),
    GATEWAY_DB: gatewayDb,
    RELAY_URL: relayUrl,
    RELAY_INTERNAL_TOKEN: RELAY_TOKEN,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

try {
  await waitFor(`${relayUrl}/healthz`, { authorization: `Bearer ${RELAY_TOKEN}` }, 'relay');
  await waitFor(`${gwUrl}/healthz`, {}, 'gateway');
  console.log(`relay ${relayUrl}, gateway ${gwUrl}\n`);

  await cli(userHome, userProj, 'project', 'init');
  await cli(userHome, userProj, 'auth', 'login', '--remote-url', gwUrl, '--token', aliceKey);
  const created = JSON.parse(
    await cli(userHome, userProj, 'workspace', 'create', '--remote-url', gwUrl, '--name', 's1-e2e'),
  ) as { workspaceId: string };
  check('user creates a workspace', created.workspaceId.startsWith('wsp_'));

  // Seed the wsp_ store on the relay so the replica's push has a peer log.
  await cli(userHome, userProj, 'project', 'sync', '--push');

  const text = 'decided on the web: ship the replica';
  const authored = await run(
    process.execPath,
    [
      REPLICA_CLI,
      'author-memory',
      '--hub',
      gwUrl,
      '--workspace',
      created.workspaceId,
      '--kind',
      'decision',
      '--text',
      text,
      '--salience',
      '8',
    ],
    { cwd: PKG_ROOT, env: { MEMORIZE_ROOT: replicaRoot, HUB_API_KEY: aliceKey } },
  );
  check('replica authors + pushes as the user', authored.code === 0, authored.stdout + authored.stderr);
  const result = authored.code === 0
    ? (JSON.parse(authored.stdout) as { accountId: string; storeId: string; accepted: number })
    : { accountId: '', storeId: '', accepted: 0 };
  check(
    'provenance writer is the calling account',
    result.accountId === aliceAccount,
    `${result.accountId} vs ${aliceAccount}`,
  );
  check('events were accepted by the Hub', result.accepted >= 1, String(result.accepted));

  const pull = await cli(userHome, userProj, 'project', 'sync', '--pull');
  check('user pulls new events', /\([1-9]\d* new/.test(pull), pull);

  let userDb = '';
  for await (const match of glob('accounts/*/projects/*/memorize.db', { cwd: userHome })) {
    userDb = join(userHome, match);
    break;
  }
  if (!userDb) throw new Error('user memorize.db not found');

  const rows = new DatabaseSync(userDb, { readOnly: true })
    .prepare('SELECT type, writer, source_project_id AS lane, payload FROM events WHERE type = ?')
    .all('memory.consolidated') as Array<{
      type: string;
      writer: string;
      lane: string | null;
      payload: string;
    }>;
  const webWrite = rows.find((row) => row.payload.includes('ship the replica'));
  check('the web-authored memory converged into the user store', Boolean(webWrite));
  check(
    'converged event carries writer = user account',
    webWrite?.writer === aliceAccount,
    JSON.stringify({ writer: webWrite?.writer }),
  );
  check(
    'converged event lives in the deterministic server lane',
    webWrite?.lane === result.storeId,
    JSON.stringify({ lane: webWrite?.lane, expected: result.storeId }),
  );

  console.log(
    failures === 0
      ? '\nS1 AUTHORING E2E PASS'
      : `\nS1 AUTHORING E2E FAIL (${failures} failed checks)`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  relay.kill();
  gateway.kill();
  await Promise.allSettled([once(relay, 'exit'), once(gateway, 'exit')]);
  await rm(sandbox, { recursive: true, force: true }).catch(() => {});
}
