import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProxyContext } from './proxy.js';
import { htmlEscape, layout, originFor, GITHUB_URL } from './views.js';

/** Docs surface (`GET /docs`, `GET /docs/<slug>`). A small registry of pages so
 * the main memorize docs can be migrated here gradually - add a page by pushing
 * one entry to DOC_PAGES; the nav is generated from it. Content is hand-written
 * HTML (no markdown dep); `render(origin)` injects this Hub's real URL into
 * example commands. The first page is the default for `/docs`. */

interface DocPage {
  slug: string;
  title: string;
  /** Sidebar group label; defaults to 'Guides'. */
  section?: string;
  /** `origin` is this Hub's public base URL, e.g. https://...fly.dev */
  render(origin: string): string;
}

const AGENT_GUIDE = `${GITHUB_URL}/blob/main/AGENT_GUIDE.md`;
const AI_SETUP = `${GITHUB_URL}/blob/main/guides/AI_SETUP.md`;

const DOC_PAGES: DocPage[] = [
  {
    slug: 'overview',
    title: 'Overview',
    render: () => `
<h1>What is memorize?</h1>
<p class="lead">One persistent project brain shared between you, Claude Code, and
Codex - local-first, event-sourced, and modeled on how human memory works. No
server required, no API key.</p>
<p>Your agent forgets everything when a session ends: what it was doing, what it
decided and why, where it stopped. memorize watches the agent work, distills what
mattered into long-term memory, and feeds the right memories back when the next
session opens - for every agent on the project, across machines.</p>

<h2>Why</h2>
<ul>
 <li><strong>Sessions die.</strong> Next session you re-explain what you were doing and why.</li>
 <li><strong>Switching agents starts over.</strong> Claude and Codex each keep their own notes.</li>
 <li><strong>Two machines = half a brain in each.</strong> Desktop context doesn't follow you to the laptop.</li>
</ul>

<h2>How it works</h2>
<ol class="steps">
 <li><strong>Capture</strong> - hooks record cheap, rule-filtered observations (file writes, decisions, task transitions). No LLM, no latency.</li>
 <li><strong>Consolidate</strong> - at session boundaries a background process distills observations into long-term memory, scored by salience. It runs through your existing <code>claude</code> / <code>codex</code> login - no API key.</li>
 <li><strong>Retrieve</strong> - next session, memories compete for a context budget by salience x recency x relevance. Forgetting happens at retrieval time; nothing is ever deleted.</li>
 <li><strong>Share</strong> - parallel sessions see each other live; the same event log syncs across machines and converges deterministically.</li>
</ol>

<p><a class="btn" href="/docs/getting-started">Get started -></a></p>
<p class="muted">Cross-machine sync runs through this Hub - see
<a href="/docs/connect">Connect</a>. The deeper design lives in
<a href="${GITHUB_URL}/blob/main/docs/ARCHITECTURE.md">ARCHITECTURE</a>.</p>
`.trim(),
  },
  {
    slug: 'getting-started',
    title: 'Getting started',
    render: () => `
<h1>Install &amp; set up memorize</h1>
<p class="lead">memorize is installed per project - and it's built to be installed
<em>by your AI assistant</em>, so you can skip the manual steps entirely.</p>

<h2>The easy way (recommended)</h2>
<p>Paste this one line into your Claude Code or Codex session. The assistant adds
the package, binds the directory, installs the right hook for itself, offers to
absorb your existing context, and verifies - no manual steps for you:</p>
<pre><code>Follow this guide to set up memorize in this project:
${AI_SETUP}</code></pre>
<p class="muted">After that you use <code>claude</code> / <code>codex</code> exactly
as before; project context arrives automatically when a session opens.</p>

<h2>The manual way</h2>
<p>Requires <strong>Node.js 22+</strong>. Always use the scoped name
<code>@shakystar/memorize</code> with npx - the unscoped <code>memorize</code> on
npm is an unrelated package.</p>

<p><strong>1. Put memorize on PATH.</strong></p>
<pre><code># Node project (has package.json) - install as a dev dependency:
pnpm add -D @shakystar/memorize      # or: npm install -D @shakystar/memorize
# pnpm workspace root: add -w. Non-Node project: install globally:
npm install -g @shakystar/memorize</code></pre>

<p><strong>2. Adopt the project</strong> - binds the current directory and imports
any <code>AGENTS.md</code> / <code>CLAUDE.md</code> / <code>.cursorrules</code> as
rules. Safe to re-run:</p>
<pre><code>npx @shakystar/memorize project setup</code></pre>
<p class="muted">Use <code>project setup</code>, not <code>project init</code> -
init creates a bare project without importing your rules.</p>

<p><strong>3. Install your agent integration</strong> - pick yours; both are
re-runnable and preserve unrelated content:</p>
<pre><code>npx @shakystar/memorize install claude    # Claude Code
npx @shakystar/memorize install codex     # Codex</code></pre>
<p class="muted"><strong>Codex only:</strong> start <code>codex</code>
interactively once and accept the hook-approval prompt - until then codex records
nothing from its sessions.</p>

<p><strong>4. Verify</strong> - expect exit <code>0</code> and
<code>"status": "ok"</code>; otherwise apply each issue's <code>fix</code> field
in order and re-run:</p>
<pre><code>npx @shakystar/memorize doctor --json</code></pre>

<h2>Next</h2>
<p><a href="/docs/connect">Sync this project across machines -></a> through the Hub.
Install snags? <a href="/docs/troubleshooting">Troubleshooting -></a>. Full CLI
reference: <a href="${AGENT_GUIDE}">AGENT_GUIDE</a>.</p>
`.trim(),
  },
  {
    slug: 'connect',
    title: 'Connect to the Hub',
    render: (origin) => {
      const url = htmlEscape(origin);
      return `
<h1>Connect a memorize client to this Hub</h1>
<p class="lead">Once memorize is <a href="/docs/getting-started">set up</a>, sync a
project's memory across machines through the Hub. You need a project-scoped API
key first - <a href="/beta">request one</a>; an operator issues it manually.</p>

<h2>1. Push from your origin machine</h2>
<p>On the machine that already has the project, push its events to the Hub:</p>
<pre><code>memorize project sync --push \\
  --remote-url ${url} \\
  --token &lt;your-key&gt;</code></pre>

<h2>2. Clone onto another machine</h2>
<p>On a second machine, clone the same project id with the same key:</p>
<pre><code>memorize project clone &lt;projectId&gt; \\
  --remote-url ${url} \\
  --token &lt;your-key&gt;</code></pre>

<h2>3. Keep them in sync</h2>
<p>Re-run <code>project sync --push</code> / <code>--pull</code> on each machine at
work boundaries. Sync is <strong>asynchronous</strong> (poll-on-boundary): the
origin can be offline when another machine pulls. Dedup is by event id, so
re-pushing is safe.</p>

<p class="muted">The key is scoped to the project you were granted - other projects
return <code>403</code>. The full CLI reference lives in the
<a href="${AGENT_GUIDE}">AGENT_GUIDE</a>.</p>
`.trim();
    },
  },
  {
    slug: 'consolidation',
    title: 'Consolidation & search',
    render: () => `
<h1>Consolidation &amp; semantic search</h1>
<p class="lead">memorize captures observations out of the box, but turning them
into long-term memory (consolidation) and ranking them semantically (search) are
optional, <strong>local</strong> steps. Both reuse tools you already have - no Hub
involvement, and no API key for the extractor.</p>

<h2>Extractor - turn observations into memories</h2>
<p>At session boundaries, consolidation distills observations into decisions,
rationale, and progress. It reuses your existing <code>claude</code> /
<code>codex</code> CLI login - no API key, no endpoint. Pin it explicitly so you
don't depend on auto-detect:</p>
<pre><code>MEMORIZE_LLM_BACKEND=claude-cli   # or: codex-cli, or: off (rule-based)</code></pre>
<p class="muted">Until a backend is set or auto-detected, consolidation is
effectively a no-op (a boundary reports <code>extractor: "none"</code>).</p>

<h2>Embeddings - semantic search</h2>
<p>Without embeddings, <code>memorize search</code> is FTS5 lexical only. Point
these at any OpenAI-compatible <code>/v1</code> endpoint (e.g. a local Ollama):</p>
<pre><code>MEMORIZE_EMBEDDINGS_ENDPOINT=http://localhost:11434/v1/embeddings
MEMORIZE_EMBEDDINGS_MODEL=bge-m3
MEMORIZE_EMBEDDINGS_API_KEY=ollama</code></pre>
<p class="muted">The key can be any dummy value for a keyless local server.
<code>bge-m3</code> (1024-dim) gives accurate Korean semantic search.</p>

<h2>Make the env reach the hooks (required)</h2>
<p>Consolidation and embedding run <em>inside</em> the hooks, which Claude Code /
Codex execute in a <strong>non-interactive</strong> shell that does <strong>not</strong>
source <code>~/.bashrc</code>. Setting the vars only in your shell rc will not
reach a hook.</p>
<ul>
 <li><strong>Windows:</strong> set persistent <em>User</em> env vars
 (<code>setx MEMORIZE_LLM_BACKEND claude-cli</code>), then <strong>restart the
 agent</strong> - <code>setx</code> doesn't affect already-running processes.</li>
 <li><strong>macOS / Linux:</strong> set them where the agent process itself
 inherits them (your login environment), not just an interactive shell rc.</li>
</ul>

<h2>Verify</h2>
<pre><code>npx @shakystar/memorize doctor</code></pre>
<p>Read the <em>Memory consolidation health</em> check - once a boundary has run
it reports the resolved backend (e.g. <code>via cli:claude</code>), not
<code>rule-based</code> / <code>none</code>.</p>

<p class="muted">All of this is local client config - the Hub only transports
synced events and is never in the loop. Full variable list:
<a href="${AGENT_GUIDE}">AGENT_GUIDE</a>.</p>
`.trim(),
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    render: () => `
<h1>Troubleshooting the install</h1>
<p class="lead">Diagnose in this order - each failure mode is distinct and the
order avoids chasing symptoms. The fastest catch-all is
<code>npx @shakystar/memorize doctor --json</code>.</p>

<h2>1. Node present and 22+?</h2>
<pre><code>node -v</code></pre>
<p>If missing or old, install from <a href="https://nodejs.org">nodejs.org</a> -
don't work around it.</p>

<h2>2. <code>EACCES</code> on <code>npm install -g</code>?</h2>
<p>The global npm dir is root-owned on many systems. Never sudo - use a user-owned
prefix:</p>
<pre><code>mkdir -p ~/.npm-global &amp;&amp; npm config set prefix ~/.npm-global
# then add to your shell profile and re-open the terminal:
export PATH="$HOME/.npm-global/bin:$PATH"</code></pre>

<h2>3. Binary not resolvable?</h2>
<pre><code>command -v memorize        # where.exe memorize on Windows</code></pre>
<p>After a global install the current shell may not see the new PATH - open a new
terminal. On Windows, confirm <code>npm prefix -g</code> is on PATH.</p>

<h2>4. WSL shadowing</h2>
<p>Inside WSL, <code>which memorize</code> returning a <code>/mnt/c/...</code> path
means the Windows install is leaking through PATH. Install inside WSL and ensure
the Linux npm bin dir precedes <code>/mnt/c</code> entries in PATH.</p>

<h2>5. Installed but unhealthy?</h2>
<pre><code>npx @shakystar/memorize doctor --json</code></pre>
<p>Apply each issue's <code>fix</code> field in order until status is
<code>ok</code>. Hooks load at session start, so start a <strong>new</strong>
agent session to see injected context.</p>

<p class="muted">Still stuck? Gather <code>node -v</code>, <code>npm -v</code>,
<code>npm prefix -g</code>, your OS/shell, the full error, and the doctor JSON,
then <a href="${GITHUB_URL}/issues">open an issue</a>.</p>
`.trim(),
  },
  {
    slug: 'event-sourcing',
    title: 'Event sourcing core',
    section: 'Internals',
    render: () => `
<h1>Event sourcing core</h1>
<p class="lead">memorize records every change as an immutable event in an
append-only log. That log is the single source of truth; everything you read back
(tasks, memories, rules) is a projection derived from it. This page describes how
the core works, at the level of the actual implementation in memorize 2.x.</p>

<h2>The event</h2>
<p>Every change is one row in an <code>events</code> table. An event carries an
identity, an ordering key, a type, the scope it touches, who produced it, and a
JSON payload:</p>
<pre><code>events(
  seq         INTEGER PRIMARY KEY,  -- replay order, assigned by SQLite
  id          TEXT UNIQUE,          -- global id, the idempotency key
  type        TEXT,                 -- e.g. task.created, memory.consolidated
  project_id  TEXT,
  scope_type  TEXT, scope_id TEXT,  -- policy | project | workstream | task | session
  actor       TEXT,
  created_at  TEXT, updated_at TEXT,
  payload     TEXT                  -- JSON
)</code></pre>
<p>Ids look like <code>evt_&lt;base36-time&gt;_&lt;random&gt;</code> and are minted
once, globally. Two columns do two different jobs: <code>seq</code> is a local
auto-increment that fixes replay order on this machine, and <code>id</code> is the
stable global identity used for deduplication and for sync watermarks. The shape is
the <code>DomainEvent</code> interface in <code>src/domain/events.ts</code>; the
table and its indexes are created by the migrations in
<code>src/storage/db.ts</code>.</p>

<h2>Storage</h2>
<p>The store is SQLite through better-sqlite3, one database file per project. It
runs in WAL mode with a 5 second busy timeout, so a reader and a writer do not
block each other and a brief lock is retried instead of failing. Schema changes are
an ordered, append-only list of migrations gated by SQLite's
<code>user_version</code>: on open, memorize runs every migration whose index is at
or above the stored version inside one <code>BEGIN IMMEDIATE</code> transaction,
then bumps the version. A second process opening the same fresh database blocks on
the lock, reads the already-bumped version, and applies nothing. The connection
setup and the ordered <code>MIGRATIONS</code> array both live in
<code>src/storage/db.ts</code>.</p>

<h2>Append and idempotency</h2>
<p>Writes are append-only: an event is inserted, never updated or deleted in place.
A locally produced event gets the next <code>seq</code>. Events arriving from
another machine are inserted with <code>INSERT OR IGNORE</code>, so a row whose
<code>id</code> already exists is skipped. That one property makes re-delivery safe:
pulling the same range twice inserts each event at most once. The write path is
<code>insertExternalEvents</code> and the watermark read is
<code>readEventsSince</code>, both in <code>src/storage/event-store.ts</code>.</p>
<p>Reads always come back in <code>seq</code> order. A pull since a watermark
resolves the watermark event's <code>seq</code> and returns everything with a
greater <code>seq</code>; an unknown watermark falls back to returning everything,
so a lost bookmark over-delivers rather than under-delivers.</p>

<h2>Projections</h2>
<p>You never read the raw log to answer a question. A single reducer,
<code>reduceProjectState</code> (<code>src/projections/projector.ts</code>), folds
the ordered events into state, and a rebuild (<code>rebuildProjectProjection</code>
in <code>src/services/projection-store.ts</code>) wipes and repopulates the
projection tables (tasks, decisions, rules, memories, and so on) in one transaction. Because the reducer is the only writer of those tables
and the rebuild is all-or-nothing, the projection stays a pure function of the log.
Run it twice and you get the same tables; crash halfway and the old tables stay
intact until the next rebuild succeeds.</p>

<h2>Invalidate, do not delete</h2>
<p>Superseding a memory or a decision does not remove the old row. The reducer
stamps it with an <code>invalidAt</code> timestamp and a pointer to what replaced
it, then leaves it in place, so a point-in-time replay still shows what was true
then. The same pattern collapses duplicate consolidations: when two machines
distill the same observations into the same memory, the reducer keeps the one with
the smaller <code>(created_at, id)</code> and marks the rest invalid
(<code>dedupeMemoriesBySource</code>, in the projector). Every machine picks the same
winner, so the result converges with no coordination.</p>

<h2>Crash consistency</h2>
<p>Applying a pull (<code>applyPullResponse</code> in
<code>src/services/sync-service.ts</code>) is ordered on purpose: insert the events
(<code>INSERT OR IGNORE</code>), rebuild the projection, then advance the watermark
last. If the process dies before the watermark advances, the bookmark is stale, so
the next pull requests the same range again; the duplicate inserts are ignored and
the idempotent rebuild repeats harmlessly. No fsync dance and no torn-line parsing
are needed, because each batch is one SQLite transaction and the log is
append-only.</p>

<h2>Why it is built this way</h2>
<p>An append-only log plus an idempotent, deterministic projection gives eventual
consistency across machines with no server, no locks, and no distributed clock.
Re-delivery is safe, replay is deterministic, and history is never lost. The next
Internals pages cover how this log syncs between machines and how memories are
ranked at retrieval time.</p>
`.trim(),
  },
  {
    slug: 'sync-convergence',
    title: 'Sync and convergence',
    section: 'Internals',
    render: () => `
<h1>Sync and convergence</h1>
<p class="lead">Two machines that do not share a filesystem stay in sync by
shipping the same append-only event log over HTTP. The origin pushes, the relay
holds, a replica pulls later. This page traces the real path in memorize 2.x:
<code>src/services/sync-service.ts</code>,
<code>src/adapters/sync-transport-http.ts</code>, and the wire contract both sides
implement (<code>memorize_hub/PROTOCOL.md</code>).</p>

<h2>The wire</h2>
<p>The HTTP transport makes two calls against the relay:</p>
<pre><code>POST {base}/v1/projects/{remoteProjectId}/events   body: SyncPushRequest  -> SyncPushResponse
GET  {base}/v1/projects/{remoteProjectId}/events?since={id}             -> SyncPullResponse</code></pre>
<p>A push carries the pending events; a pull asks for everything after a marker. The
relay treats each event as opaque JSON: it never parses or validates a payload, it
only preserves insertion order. An optional bearer token rides in
<code>Authorization: Bearer ...</code>.</p>

<h2>Watermarks</h2>
<p>Each machine keeps its own bookmarks in a sync-state file, not in the event log:
<code>lastPushedEventId</code> and <code>lastPulledEventId</code>. A push slices the
log with <code>readEventsSince(lastPushedEventId)</code> (every event with a greater
<code>seq</code>) and sends only that; a pull sends <code>since=lastPulledEventId</code>
and the relay returns the tail after it. After a successful push,
<code>markPushed</code> advances the push bookmark to the relay's
<code>lastAcceptedEventId</code>.</p>

<h2>Sync bookkeeping stays local</h2>
<p>Writing the sync state also appends a <code>sync.state.updated</code> event to the
local log (<code>writeState</code>). That event is deliberately filtered out of every
push: <code>buildPushPayload</code> drops <code>sync.state.updated</code> before
sending. The reason is simple. Each machine's watermarks are private bookmarks into a
shared log, so shipping one machine's bookmarks to another would only say where the
first machine had read up to, which is meaningless and divergent on the second. The
wire carries domain events only. A no-op push at an idle boundary writes zero sync
events, to avoid log churn now that sync runs automatically.</p>

<h2>Re-delivery is safe by construction</h2>
<p>The client never relies on the relay to deduplicate. Applying a pull is ordered:
insert the events with <code>INSERT OR IGNORE</code>, rebuild the projection, then
advance <code>lastPulledEventId</code> last (<code>applyPullResponse</code>). If the
process dies before the bookmark advances, the next pull requests the same range
again; the duplicate inserts are ignored and the idempotent rebuild repeats with no
effect. Relay-side dedup by id is recommended but optional, because the client
absorbs duplicates either way.</p>

<h2>Joining a project: true-replica clone</h2>
<p>A second machine joins by adopting the origin's project id, never minting its own
(<code>cloneProject</code>, memorize #30). The clone runs in a fresh directory, writes
a sync state that points at the remote, binds the directory, and pulls. The remote's
<code>project.created</code> arrives as the first event, so both machines share one
identity (git analog: same commit ids, different working copy). Two guards keep this
honest: clone refuses a directory already bound to a different project id (that would
be a diverged-history merge, still unsupported), and the reducer throws if it ever
sees two different <code>project.created</code> ids in one log instead of silently
letting the last one win.</p>

<h2>What actually converges</h2>
<p>Sync guarantees that every machine ends up holding the same set of events, because
re-delivery is idempotent and ids are global. On top of that set, two layers make the
derived state agree:</p>
<ul>
 <li><strong>Memories</strong> distilled concurrently on two machines from the same
 observations collapse to one. The projector groups still-valid memories by their
 source observation ids plus kind plus normalized text, keeps the winner by
 <code>(createdAt, id)</code> ascending, and marks the rest invalid
 (<code>dedupeMemoriesBySource</code>). It is content-keyed and pure, so every replica
 picks the same winner regardless of the order events arrived.</li>
 <li><strong>Structural entities</strong> (tasks, decisions, rules) replay in each
 machine's local <code>seq</code> order, which is the insertion order on that machine.
 Within one machine that order is causal, so ordinary edits agree. Concurrent edits to
 the same field on two machines are resolved by replay order today, not by a logical
 clock; a hybrid logical clock for a strict cross-machine total order is tracked as
 memorize #39.</li>
</ul>

<h2>Where the Hub fits</h2>
<p>The Hub is this relay with a control plane in front. It stores the opaque events,
preserves their order, deduplicates by id, and injects the internal relay token after
checking your project-scoped key. It never interprets a payload, so the client schema
can evolve without touching it. See <a href="/docs/connect">Connect</a> for the
commands and <a href="/docs/event-sourcing">Event sourcing core</a> for the log and
projection underneath.</p>
`.trim(),
  },
];

/** Left sidebar nav generated from the page registry, grouped by section. */
function docsSide(currentSlug: string): string {
  const groups = new Map<string, DocPage[]>();
  for (const page of DOC_PAGES) {
    const section = page.section ?? 'Guides';
    (groups.get(section) ?? groups.set(section, []).get(section)!).push(page);
  }
  const sections = [...groups.entries()]
    .map(([section, pages]) => {
      const items = pages
        .map((p) => {
          const current = p.slug === currentSlug ? ' aria-current="page"' : '';
          return `<li><a href="/docs/${p.slug}"${current}>${htmlEscape(p.title)}</a></li>`;
        })
        .join('');
      return `<p class="label">${htmlEscape(section)}</p><ul>${items}</ul>`;
    })
    .join('');
  return `<nav class="docs-side">${sections}</nav>`;
}

/** Two-column docs shell: sidebar + content. */
function docsPage(title: string, slug: string, content: string): string {
  return layout({
    title,
    body: `<div class="docs-wrap">${docsSide(slug)}<div class="docs-main">${content}</div></div>`,
    wide: true,
  });
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    docsPage(
      'memorize Hub - docs',
      '',
      '<h1>Page not found</h1><p>No such docs page. <a href="/docs">Back to docs</a>.</p>',
    ),
  );
}

/** Route `/docs` (-> first page) and `/docs/<slug>`. */
export function handleDocs(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProxyContext,
  url: URL,
): void {
  // pathname is '/docs' or '/docs/<slug>' (server only routes GET here).
  const rest = url.pathname.replace(/^\/docs\/?/, '');
  const slug = rest === '' ? DOC_PAGES[0]!.slug : rest;
  const page = DOC_PAGES.find((p) => p.slug === slug);
  if (!page) {
    notFound(res);
    return;
  }
  const origin = originFor(req, ctx.config);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(docsPage(`memorize Hub - ${page.title}`, page.slug, page.render(origin)));
}
