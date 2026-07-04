# `connect` Verb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `memorize connect <hub-url>` verb that auto-branches to clone (fresh dir) or remote (bound project), keep clone/remote as aliases, and collapse the Hub onboarding copy to one `connect` line plus an AI-agent setup line.

**Architecture:** In `../memorize`, `connect` becomes a third subcommand of `runProjectCommand` that dispatches on `getBindingForPath(cwd)`; the existing clone/remote bodies are extracted into shared `doClone`/`doRemote` helpers so all three verbs reuse them. In `memorize_hub`, the web Connect tab and every gateway `web.ts` onboarding site drop the `npm i -g` + separate clone/remote blocks in favor of `login` + `connect` and a single agent-guide line.

**Tech Stack:** TypeScript (Node ESM), vitest, React (packages/web), `node:http` gateway (packages/gateway).

## Global Constraints

- **Repo sequencing:** CLI PR (`../memorize`) lands and releases FIRST; web PR (`memorize_hub`) lands SECOND. Do not merge web before CLI ships — copied `memorize connect` breaks on a pre-connect CLI.
- **Branch:** `feat/connect-verb` in BOTH repos. CLI worktree is a NEW `../memorize` worktree; web worktree is the existing `C:/dev/active/memorize_hub-connect`.
- **clone/remote stay working** as backward-compatible aliases — no deprecation warning, behavior byte-identical (existing tests must pass unchanged).
- **Branch rule (exact copy):** `kind:'exact'` → remote; `undefined` (no binding) → clone; `kind:'ancestor'` → explicit error (never auto-guess).
- **Hub URL contract unchanged:** input is always an http(s) URL whose last path segment is the store id; parsing stays in `parseHubUrl` (src/cli/hub-url.ts).
- **Setup guide URL (verbatim):** `https://github.com/shakystar/memorize/blob/main/guides/AI_SETUP.md`
- **Web onboarding blocks:** command block is exactly `memorize login <origin>` + `memorize connect <cloneUrl>` (no `npm i -g`); install/env wiring is delegated to the agent-guide line.

---

## PR #1 — CLI (`../memorize`)

> Execute these tasks in a fresh `../memorize` worktree on branch `feat/connect-verb`.
> File paths below are relative to the `../memorize` repo root.

### Task 1: Extract `doClone` / `doRemote` helpers (pure refactor)

Behavior stays identical; this only lifts the clone/remote bodies into reusable
functions so Task 2's `connect` can call them. Verified by the EXISTING clone/remote
tests passing unchanged — no new test in this task.

**Files:**
- Modify: `src/cli/commands/project.ts` (clone body ~173-225, remote body ~227-276)

**Interfaces:**
- Produces:
  - `async function doClone(cwd: string, remoteProjectId: string, flagArgs: string[]): Promise<void>`
  - `async function doRemote(cwd: string, target: string, flagArgs: string[]): Promise<void>`
  - (`target` for `doRemote` is a Hub URL string; `flagArgs` is the raw flag tail, e.g. `['--token', 't']`.)

- [ ] **Step 1: Add the two module-level helpers** above `runProjectCommand` (after `redactSyncStateForDisplay`).

```ts
/**
 * Adopt a remote project into a FRESH dir (true-replica clone, #30). Caller has
 * already resolved the remote id + put `--remote-url` (etc.) into `flagArgs`.
 */
async function doClone(
  cwd: string,
  remoteProjectId: string,
  flagArgs: string[],
): Promise<void> {
  const flags = parseFlags(flagArgs, {
    single: ['remote-path', 'remote-url', 'token', 'encryption-key'],
  });
  const { transport, config } = await resolveTransportFlags(flags.single);
  const encryptionKey = flags.single['encryption-key'];
  if (encryptionKey) {
    keyId(encryptionKey);
  }
  const result = await cloneProject(
    cwd,
    remoteProjectId,
    transport,
    config,
    encryptionKey,
  );
  const encNote = encryptionKey
    ? ` E2E encryption is on (kid ${keyId(encryptionKey)}).`
    : '';
  console.log(
    result.pulled > 0
      ? `Cloned project ${result.projectId} (${result.pulled} events pulled).${encNote}`
      : `Bound to remote project ${result.projectId}; no events yet. ` +
          'Run `memorize project sync --pull --remote-path <path>` after the source pushes.' +
          encNote,
  );
}

/**
 * Attach a Hub remote to the EXISTING bound project + run the first push/pull
 * (git-remote analog). Requires a bound project in `cwd`.
 */
async function doRemote(
  cwd: string,
  target: string,
  flagArgs: string[],
): Promise<void> {
  const projectId = await requireBoundProjectId(cwd);
  const flags = parseFlags(flagArgs, { single: ['token'] });
  const hub = parseHubUrl(target);
  const { transport, config } = await resolveTransportFlags({
    'remote-url': hub.remoteUrl,
    ...(flags.single.token ? { token: flags.single.token } : {}),
  });
  await updateSyncState(projectId, {
    remoteProjectId: hub.remoteProjectId,
    syncEnabled: true,
    syncTransport: config,
  });
  await tryReconcileWorkspaceBinding(projectId);
  await tryEnsureSourceStoreRegistration(projectId);
  const pushed = await pushProject(projectId, transport);
  const pulled = await pullProject(projectId, transport);
  await tryRefreshWorkspaceBinding(projectId);
  const dupes = pulled.total - pulled.inserted;
  console.log(
    `Attached remote ${hub.remoteProjectId} (${hub.remoteUrl}).\n` +
      `First sync: pushed ${pushed.accepted.length} events, pulled ` +
      `${pulled.total} (${pulled.inserted} new, ${dupes} duplicates ` +
      `skipped). Session boundaries auto-sync from here on.`,
  );
}
```

- [ ] **Step 2: Replace the `clone` subcommand body** (project.ts ~173-225) with a thin wrapper that keeps the URL-expansion + usage check, then calls `doClone`:

```ts
if (subcommand === 'clone') {
  // True-replica join (#30): adopt the remote projectId in a FRESH dir.
  let remoteProjectId = args[1];
  let flagArgs = args.slice(2);
  // Git-style positional: `memorize clone https://hub/<anything>/<id>` carries
  // the remote + id in one copy-pasteable arg — expand to `<id> --remote-url`.
  if (remoteProjectId && isHttpUrl(remoteProjectId)) {
    const hub = parseHubUrl(remoteProjectId);
    remoteProjectId = hub.remoteProjectId;
    flagArgs = ['--remote-url', hub.remoteUrl, ...flagArgs];
  }
  if (!remoteProjectId) {
    throw new Error(
      'Usage: memorize clone <hub-url-ending-in-id> | ' +
        'memorize project clone <remoteProjectId> ' +
        '(--remote-path <path> | --remote-url <url> [--token <t>]) ' +
        '[--encryption-key <b64>]',
    );
  }
  await doClone(cwd, remoteProjectId, flagArgs);
  return;
}
```

- [ ] **Step 3: Replace the `remote` subcommand body** (project.ts ~227-276) with a wrapper that keeps the no-arg "print attached remote" branch, then calls `doRemote`:

```ts
if (subcommand === 'remote') {
  const target = args[1];
  if (!target) {
    // `git remote -v` analog: no arg prints the attached remote, if any.
    const projectId = await requireBoundProjectId(cwd);
    const state = await readSyncState(projectId);
    if (state?.syncTransport?.type === 'http') {
      console.log(
        `${state.remoteProjectId ?? projectId}\t${state.syncTransport.url}`,
      );
      return;
    }
    throw new Error(
      'Usage: memorize remote <hub-url-ending-in-id> [--token <t>] ' +
        '(no remote is attached yet)',
    );
  }
  await doRemote(cwd, target, args.slice(2));
  return;
}
```

- [ ] **Step 4: Typecheck + run the existing clone/remote suites** — behavior must be unchanged.

Run: `cd ../memorize && pnpm typecheck && pnpm vitest run tests/integration/remote-attach-cli.test.ts tests/integration/clone-roundtrip.test.ts`
Expected: PASS (no assertion changes).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/project.ts
git commit -m "refactor(cli): extract doClone/doRemote helpers from clone/remote bodies"
```

---

### Task 2: Add `connect` verb + `resolveConnectRoute` decision + index alias

**Files:**
- Modify: `src/cli/commands/project.ts` (add `resolveConnectRoute` + `connect` branch)
- Modify: `src/cli/index.ts:46` (add `connect` alias next to clone/remote)
- Create: `tests/unit/connect-route.test.ts`
- Create: `tests/integration/connect-cli.test.ts`

**Interfaces:**
- Consumes: `doClone`, `doRemote` (Task 1); `getBindingForPath` (project-service); `parseHubUrl` (hub-url); `BindingMatch` (storage/bindings-store).
- Produces: `export function resolveConnectRoute(binding: BindingMatch | undefined): 'clone' | 'remote'` (throws on `kind:'ancestor'`).

- [ ] **Step 1: Write the failing unit test** for the routing decision.

Create `tests/unit/connect-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { resolveConnectRoute } from '../../src/cli/commands/project.js';
import type { BindingMatch } from '../../src/storage/bindings-store.js';

describe('resolveConnectRoute — connect verb dispatch', () => {
  it('routes a fresh/unbound dir to clone', () => {
    expect(resolveConnectRoute(undefined)).toBe('clone');
  });

  it('routes an exact-bound project dir to remote', () => {
    const binding: BindingMatch = {
      projectId: 'proj_x',
      matchedPath: '/repo',
      kind: 'exact',
    };
    expect(resolveConnectRoute(binding)).toBe('remote');
  });

  it('refuses a nested (ancestor) dir with an actionable error', () => {
    const binding: BindingMatch = {
      projectId: 'proj_parent',
      matchedPath: '/repo',
      kind: 'ancestor',
    };
    expect(() => resolveConnectRoute(binding)).toThrow(/nested inside project proj_parent/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ../memorize && pnpm vitest run tests/unit/connect-route.test.ts`
Expected: FAIL — `resolveConnectRoute` is not exported.

- [ ] **Step 3: Add `resolveConnectRoute`** to `src/cli/commands/project.ts` (module level, near the helpers) and import `BindingMatch`.

Add to the imports at the top of the file:

```ts
import type { BindingMatch } from '../../storage/bindings-store.js';
```

Add the function:

```ts
/**
 * Decide which existing verb `connect` dispatches to, from the cwd binding:
 * an EXACT binding (this dir IS a project) attaches a remote; no binding is a
 * fresh replica clone. An ANCESTOR binding (nested subdir) is ambiguous —
 * clone-a-nested-replica vs attach-the-parent — so refuse and let the user pick.
 */
export function resolveConnectRoute(
  binding: BindingMatch | undefined,
): 'clone' | 'remote' {
  if (binding?.kind === 'ancestor') {
    throw new Error(
      `Directory is nested inside project ${binding.projectId} ` +
        `(bound at ${binding.matchedPath}). \`connect\` won't guess here. ` +
        'Run `memorize clone <url>` in a fresh directory to join as a separate ' +
        'replica, or `memorize remote <url>` to attach THIS project to the remote.',
    );
  }
  return binding?.kind === 'exact' ? 'remote' : 'clone';
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd ../memorize && pnpm vitest run tests/unit/connect-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the `connect` subcommand branch** to `runProjectCommand` (place it right before the `clone` branch):

```ts
if (subcommand === 'connect') {
  const target = args[1];
  if (!target) {
    throw new Error(
      'Usage: memorize connect <hub-url-ending-in-id> [--token <t>]',
    );
  }
  // Validate the URL up front (throws on non-URL / missing store id) so a typo
  // fails before we touch the binding store.
  const hub = parseHubUrl(target);
  const route = resolveConnectRoute(await getBindingForPath(cwd));
  if (route === 'remote') {
    await doRemote(cwd, target, args.slice(2));
  } else {
    await doClone(cwd, hub.remoteProjectId, [
      '--remote-url',
      hub.remoteUrl,
      ...args.slice(2),
    ]);
  }
  return;
}
```

- [ ] **Step 6: Add the `connect` alias** in `src/cli/index.ts` (right after the clone/remote aliases at line 46):

```ts
  // `memorize connect <hub-url>` — auto-branches: fresh dir clones, bound
  // project attaches a remote. clone/remote remain as explicit aliases.
  connect: (args, ctx) => runProjectCommand(['connect', ...args], ctx),
```

- [ ] **Step 7: Write the failing integration test** for real dispatch via the relay stub.

Create `tests/integration/connect-cli.test.ts`:

```ts
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runProjectCommand } from '../../src/cli/commands/project.js';
import {
  createProject,
  getBoundProjectId,
  readSyncState,
} from '../../src/services/project-service.js';
import { createTask } from '../../src/services/task-service.js';
import { closeAll } from '../../src/storage/db.js';
import { startRelayStub, type RelayStub } from '../harness/relay-stub.js';

let sandbox: string;
let relay: RelayStub;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'memorize-connect-cli-'));
  relay = await startRelayStub();
});

afterEach(async () => {
  closeAll();
  delete process.env.MEMORIZE_ROOT;
  await relay.close();
  await rm(sandbox, { recursive: true, force: true });
});

function useMachine(root: string): void {
  closeAll();
  process.env.MEMORIZE_ROOT = root;
}

describe('memorize connect — auto-branch clone/remote', () => {
  it('attaches a remote when the cwd is an exact-bound project', async () => {
    const homeA = join(sandbox, 'home-a');
    const cwdA = join(sandbox, 'a');
    await mkdir(cwdA, { recursive: true });

    useMachine(homeA);
    const projectA = await createProject({ title: 'Origin', rootPath: cwdA });
    await createTask({ projectId: projectA.id, title: 'Origin task', actor: 'user' });

    await runProjectCommand(
      ['connect', `${relay.baseUrl}/clone/${projectA.id}`],
      { cwd: cwdA },
    );

    // Took the REMOTE path: binding persisted + first push landed on the relay.
    const state = await readSyncState(projectA.id);
    expect(state?.remoteProjectId).toBe(projectA.id);
    expect(state?.syncTransport).toEqual({ type: 'http', url: relay.baseUrl });
    expect(relay.events(projectA.id).length).toBeGreaterThan(0);
  });

  it('clones into a fresh dir when there is no binding', async () => {
    // Origin machine seeds the relay.
    const homeA = join(sandbox, 'home-a');
    const cwdA = join(sandbox, 'a');
    await mkdir(cwdA, { recursive: true });
    useMachine(homeA);
    const projectA = await createProject({ title: 'Origin', rootPath: cwdA });
    await createTask({ projectId: projectA.id, title: 'Origin task', actor: 'user' });
    await runProjectCommand(
      ['remote', `${relay.baseUrl}/clone/${projectA.id}`],
      { cwd: cwdA },
    );

    // Second machine, fresh dir: connect must CLONE (adopt the remote id).
    const homeB = join(sandbox, 'home-b');
    const cwdB = join(sandbox, 'b');
    await mkdir(cwdB, { recursive: true });
    useMachine(homeB);

    await runProjectCommand(
      ['connect', `${relay.baseUrl}/clone/${projectA.id}`],
      { cwd: cwdB },
    );

    // Adopted the SAME projectId (true replica) and pulled the origin history.
    expect(await getBoundProjectId(cwdB)).toBe(projectA.id);
    const stateB = await readSyncState(projectA.id);
    expect(stateB?.remoteProjectId).toBe(projectA.id);
  });

  it('rejects a bare non-URL arg before touching the binding', async () => {
    const cwd = join(sandbox, 'x');
    await mkdir(cwd, { recursive: true });
    useMachine(join(sandbox, 'home-x'));
    await expect(
      runProjectCommand(['connect', 'not-a-url'], { cwd }),
    ).rejects.toThrow(/valid URL|must end in/);
  });
});
```

- [ ] **Step 8: Run the integration test**

Run: `cd ../memorize && pnpm vitest run tests/integration/connect-cli.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Full CLI check** (typecheck + lint + the touched suites)

Run: `cd ../memorize && pnpm typecheck && pnpm vitest run tests/unit/connect-route.test.ts tests/integration/connect-cli.test.ts tests/integration/remote-attach-cli.test.ts tests/integration/clone-roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/cli/commands/project.ts src/cli/index.ts tests/unit/connect-route.test.ts tests/integration/connect-cli.test.ts
git commit -m "feat(cli): add connect verb that auto-branches clone/remote on cwd binding"
```

- [ ] **Step 11: Open PR #1** against `../memorize` main. This PR must merge + release before any web copy change lands.

---

## PR #2 — Web copy (`memorize_hub`)

> Execute in the existing `C:/dev/active/memorize_hub-connect` worktree (branch `feat/connect-verb`).
> File paths below are relative to the `memorize_hub` repo root.
> **Do not open this PR until PR #1 is released.**

### Task 3: Collapse `ConnectTab.tsx` to one command block + agent line

**Files:**
- Modify: `packages/web/src/components/canvas/ConnectTab.tsx`

**Interfaces:**
- Consumes: nothing new. Reuses existing `CopyButton` / `CommandBlock` in the file.

- [ ] **Step 1: Replace the `ConnectTab` component body** (the two `CommandBlock`s and the trailing note) with a single command block + an agent-guide section. Leave `CopyButton` and `CommandBlock` untouched.

```tsx
const SETUP_GUIDE_URL =
  'https://github.com/shakystar/memorize/blob/main/guides/AI_SETUP.md';

export function ConnectTab({ workspaceId }: { workspaceId: string }) {
  const origin = window.location.origin;
  const cloneUrl = `${origin}/clone/${workspaceId}`;
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Quick setup — if you&apos;ve done this before</h2>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-card px-3 py-1.5 text-xs font-mono">
            {cloneUrl}
          </code>
          <CopyButton text={cloneUrl} />
        </div>
      </section>

      <CommandBlock
        title="Set up on a new machine or project"
        cmds={[`memorize login ${origin}`, `memorize connect ${cloneUrl}`]}
      />

      <section className="mt-4 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">…or hand setup to your AI agent</h2>
          <CopyButton
            text={`Follow this guide to set up memorize in this project: ${SETUP_GUIDE_URL}`}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Paste this to your coding agent — it installs and wires memorize for you:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-card px-3 py-2 text-xs font-mono leading-6">
          {`Follow this guide to set up memorize in this project:\n${SETUP_GUIDE_URL}`}
        </pre>
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        After connecting, sync runs automatically at session boundaries.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Update the component's doc comment** (top of file, ~lines 6-12) so it no longer promises "two full command branches":

```tsx
/**
 * Connect — the workspace's always-there onboarding surface, in GitHub
 * quick-setup grammar: the share URL bar, then one command block
 * (`login` + `connect`, which auto-branches between a fresh machine and an
 * existing local project). No `npm i -g` line — install and env wiring go
 * through the AI_SETUP guide. Same copy as the /clone/:id landing.
 */
```

- [ ] **Step 3: Typecheck + lint the web package**

Run: `pnpm --filter @shakystar/memorize-hub-web typecheck && pnpm --filter @shakystar/memorize-hub-web lint`
(If the package name differs, use `pnpm -r --filter ./packages/web typecheck`.)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/canvas/ConnectTab.tsx
git commit -m "feat(web): collapse Connect tab to a single connect block + agent-setup line"
```

---

### Task 4: Convert every gateway `web.ts` onboarding site to `connect`

**Files:**
- Modify: `packages/gateway/src/web.ts` (5 sites + a shared helper)
- Modify: `packages/gateway/tests/integration/clone-page.test.ts`

**Interfaces:**
- Produces: `const SETUP_GUIDE_URL` + `function onboardingCommands(origin, cloneUrl): string` used by all onboarding sites.

- [ ] **Step 1: Update the failing test first** — rewrite the member-render assertions in `clone-page.test.ts` (the `renders the onboarding commands for a member` case, ~lines 57-71) to expect `connect` and forbid the old lines:

```ts
  it('renders the onboarding commands for a member', async () => {
    const res = await fetch(`${base}/clone/${storeId}`, {
      headers: { cookie: cookieFor(owner, 'owner@e.com') },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('memorize login https://hub.example');
    expect(html).toContain(`memorize connect https://hub.example/clone/${storeId}`);
    // The separate clone/remote blocks and the manual install line are gone.
    expect(html).not.toContain('npm i -g @shakystar/memorize');
    expect(html).not.toContain(`memorize clone https://hub.example/clone/${storeId}`);
    expect(html).not.toContain(`memorize remote https://hub.example/clone/${storeId}`);
    // Agent-guided setup replaces the manual install.
    expect(html).toContain(
      'https://github.com/shakystar/memorize/blob/main/guides/AI_SETUP.md',
    );
    expect(html).toContain('demo'); // the workspace name headlines the page
    expect(html).not.toContain('memorize project sync');
    expect(html).toContain('sync runs automatically at session boundaries');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @shakystar/memorize-hub-gateway vitest run tests/integration/clone-page.test.ts`
Expected: FAIL — page still renders clone/remote + `npm i -g`.

- [ ] **Step 3: Add the shared helper** near the top of `packages/gateway/src/web.ts` (after the `cmdBlock` definition):

```ts
const SETUP_GUIDE_URL =
  'https://github.com/shakystar/memorize/blob/main/guides/AI_SETUP.md';

/**
 * The canonical Hub onboarding snippet: `login` + `connect` (which auto-branches
 * clone/remote), then a single line the user pastes to their AI agent for
 * install + env wiring. Replaces the old npm-install + separate clone/remote
 * blocks everywhere it is used.
 */
function onboardingCommands(origin: string, cloneUrl: string): string {
  return `${cmdBlock(`memorize login ${origin}`)}
${cmdBlock(`memorize connect ${cloneUrl}`)}
<p class="mt-3 text-sm prose-muted">Or hand setup to your AI agent — paste this to your coding agent:</p>
${cmdBlock(`Follow this guide to set up memorize in this project: ${SETUP_GUIDE_URL}`)}`;
}
```

- [ ] **Step 4: Replace site 1 — landing summary** (`web.ts` ~118-126). Old:

```ts
 <p class="text-sm prose-muted mb-1">Connect a machine once, then clone any project:</p>
 ${cmdBlock('npm i -g @shakystar/memorize')}
 ${cmdBlock(`memorize login ${origin}`)}
 ${cmdBlock(`memorize clone ${origin}/clone/PROJECT_ID`)}
 <p class="mt-2 text-sm prose-muted">From there, sync runs automatically at session boundaries.</p>
```

New:

```ts
 <p class="text-sm prose-muted mb-1">Connect a machine, then let memorize sync every project:</p>
 ${onboardingCommands(origin, `${origin}/clone/PROJECT_ID`)}
 <p class="mt-2 text-sm prose-muted">From there, sync runs automatically at session boundaries.</p>
```

- [ ] **Step 5: Replace site 2 — landing detail grid** (`web.ts` ~194-208). Old (the install/login/clone steps + the "Already have the project locally?" remote block):

```ts
<h2 class="${H2}">1. Install memorize</h2>
${cmdBlock('npm i -g @shakystar/memorize')}
<h2 class="${H2}">2. Log in once per machine</h2>
<p class="${P}">Opens your browser to approve the device — nothing to paste.</p>
${cmdBlock(`memorize login ${o}`)}
<h2 class="${H2}">3. Clone the project</h2>
<p class="${P}">Every workspace shows its clone URL in the
 <a href="/app" class="text-accent hover:underline">dashboard</a>.
 <code class="font-mono">clone</code> stores the remote and pulls once — use it, not
 <code class="font-mono">init</code>, which forks a new empty project that will not sync.</p>
${cmdBlock(`memorize clone ${o}/clone/PROJECT_ID`)}
<h2 class="${H2}">Already have the project locally?</h2>
<p class="${P}">Run steps 1–2, then attach the remote instead of cloning — it pushes and pulls
 once right away.</p>
${cmdBlock(`memorize remote ${o}/clone/PROJECT_ID`)}
```

New:

```ts
<h2 class="${H2}">1. Log in once per machine</h2>
<p class="${P}">Opens your browser to approve the device — nothing to paste.</p>
${cmdBlock(`memorize login ${o}`)}
<h2 class="${H2}">2. Connect the project</h2>
<p class="${P}">Every workspace shows its URL in the
 <a href="/app" class="text-accent hover:underline">dashboard</a>.
 <code class="font-mono">connect</code> clones into a fresh directory or attaches to a
 project you already have locally — it picks the right one automatically.</p>
${cmdBlock(`memorize connect ${o}/clone/PROJECT_ID`)}
<h2 class="${H2}">Prefer to let your AI agent set it up?</h2>
<p class="${P}">Paste this to your coding agent — it installs memorize and wires the
 environment for you:</p>
${cmdBlock(`Follow this guide to set up memorize in this project: ${SETUP_GUIDE_URL}`)}
```

- [ ] **Step 6: Replace site 3 — Commands reference** (`web.ts` ~258-263). This is a reference page, so document `connect` as primary and note the aliases in one line. Old:

```ts
<h2 class="${H2}">memorize clone</h2>
<p class="${P}">Copy a project from its share URL: stores the remote and does the first pull.</p>
${cmdBlock(`memorize clone ${o}/clone/PROJECT_ID`)}
<h2 class="${H2}">memorize remote</h2>
<p class="${P}">Attach a remote to a project you already have locally, then push and pull once.</p>
${cmdBlock(`memorize remote ${o}/clone/PROJECT_ID`)}
```

New:

```ts
<h2 class="${H2}">memorize connect</h2>
<p class="${P}">Connect a project from its share URL: clones into a fresh directory or
 attaches a remote to a project you already have locally — whichever fits, chosen
 automatically. (<code class="font-mono">clone</code> and <code class="font-mono">remote</code>
 remain as explicit aliases.)</p>
${cmdBlock(`memorize connect ${o}/clone/PROJECT_ID`)}
```

- [ ] **Step 7: Replace site 4 — workspace-joined page** (`web.ts` ~828-835). Old:

```ts
<p class="mt-4 text-sm prose-muted">Join from a new machine:</p>
${cmdBlock('npm i -g @shakystar/memorize')}
${cmdBlock(`memorize login ${origin}`)}
${cmdBlock(`memorize clone ${origin}/clone/${result.storeId}`)}
<p class="mt-3 text-sm prose-muted">Already have the project locally?</p>
${cmdBlock('npm i -g @shakystar/memorize')}
${cmdBlock(`memorize login ${origin}`)}
${cmdBlock(`memorize remote ${origin}/clone/${result.storeId}`)}
```

New:

```ts
<p class="mt-4 text-sm prose-muted">Connect from any machine:</p>
${onboardingCommands(origin, `${origin}/clone/${result.storeId}`)}
```

- [ ] **Step 8: Replace site 5 — `/clone/:storeId` share landing** (`web.ts` ~880-892). Old:

```ts
<div class="mt-4">
${cmdBlock('npm i -g @shakystar/memorize')}
${cmdBlock(`memorize login ${origin}`)}
${cmdBlock(`memorize clone ${cloneUrl}`)}
</div>
<p class="mt-3 text-sm prose-muted">Already have the project locally?</p>
${cmdBlock('npm i -g @shakystar/memorize')}
${cmdBlock(`memorize login ${origin}`)}
${cmdBlock(`memorize remote ${cloneUrl}`)}
```

New:

```ts
<div class="mt-4">
${onboardingCommands(origin, cloneUrl)}
</div>
```

- [ ] **Step 9: Run the gateway test to verify it passes**

Run: `pnpm --filter @shakystar/memorize-hub-gateway vitest run tests/integration/clone-page.test.ts`
Expected: PASS.

- [ ] **Step 10: Full repo check** (typecheck + lint + test across both packages)

Run: `pnpm -r check`
Expected: PASS. If any other gateway test asserted the old `npm i -g` / `memorize clone` copy, update it to the new `connect` copy the same way.

- [ ] **Step 11: Commit**

```bash
git add packages/gateway/src/web.ts packages/gateway/tests/integration/clone-page.test.ts
git commit -m "feat(gateway): convert all onboarding copy to memorize connect + agent-setup line"
```

- [ ] **Step 12: Open PR #2** against `memorize_hub` main (only after PR #1 released).

---

## Self-Review

**Spec coverage:**
- connect auto-branches fresh→clone / bound→remote → Task 2 (branch + resolveConnectRoute) ✓
- nested→explicit error → Task 2 Step 3 (`resolveConnectRoute` ancestor throw) + unit test ✓
- clone/remote aliases kept, no regression → Task 1 (pure refactor) + Task 1 Step 4 (existing suites pass) ✓
- ConnectTab + /clone landing + web.ts all sites → single connect line + AI_SETUP line → Tasks 3 & 4 (5 sites + ConnectTab) ✓
- CLI released before web → Global Constraints + Task 2 Step 11 / Task 4 Step 12 gating ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; test bodies are complete. ✓

**Type consistency:** `doClone(cwd, remoteProjectId, flagArgs)` / `doRemote(cwd, target, flagArgs)` / `resolveConnectRoute(binding): 'clone'|'remote'` used identically in every reference; `BindingMatch { projectId, matchedPath, kind }` matches src/storage/bindings-store.ts. ✓

**Note on `pnpm --filter` names:** the web/gateway package filter names (`@shakystar/memorize-hub-web` / `-gateway`) are best-effort; if a filter errors, fall back to path filters (`--filter ./packages/web`) or the root `pnpm -r check`. This does not change any deliverable.
