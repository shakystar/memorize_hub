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
];

/** Left sidebar nav generated from the page registry. */
function docsSide(currentSlug: string): string {
  const items = DOC_PAGES.map((p) => {
    const current = p.slug === currentSlug ? ' aria-current="page"' : '';
    return `<li><a href="/docs/${p.slug}"${current}>${htmlEscape(p.title)}</a></li>`;
  }).join('');
  return `<nav class="docs-side"><p class="label">Documentation</p><ul>${items}</ul></nav>`;
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
