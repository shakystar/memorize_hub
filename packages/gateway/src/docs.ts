import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProxyContext } from './proxy.js';
import { htmlEscape, layout, originFor, GITHUB_URL } from './views.js';

/** Docs surface (`GET /docs`, `GET /docs/<slug>`). A small registry of pages so
 * the main memorize docs can be migrated here gradually — add a page by pushing
 * one entry to DOC_PAGES; the nav is generated from it. Content is hand-written
 * HTML (no markdown dep); `render(origin)` injects this Hub's real URL into
 * example commands. */

interface DocPage {
  slug: string;
  title: string;
  /** `origin` is this Hub's public base URL, e.g. https://…fly.dev */
  render(origin: string): string;
}

const DOC_PAGES: DocPage[] = [
  {
    slug: 'connect',
    title: 'Connect to the Hub',
    render: (origin) => {
      const url = htmlEscape(origin);
      return `
<h1>Connect a memorize client to this Hub</h1>
<p class="lead">Sync a project's memory across machines through the Hub. You need
a project-scoped API key first — <a href="/beta">request one</a>; an operator
issues it manually.</p>

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

<p class="muted">The key is scoped to the project you were granted — other
projects return <code>403</code>. The full memorize CLI reference lives on
<a href="${GITHUB_URL}">GitHub</a>.</p>
`.trim();
    },
  },
];

function docsNav(currentSlug: string): string {
  const items = DOC_PAGES.map((p) => {
    const current = p.slug === currentSlug ? ' aria-current="page"' : '';
    return `<li><a href="/docs/${p.slug}"${current}>${htmlEscape(p.title)}</a></li>`;
  }).join('');
  return `<ul class="docs-nav">${items}</ul>`;
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    layout({
      title: 'memorize Hub — docs',
      body: `${docsNav('')}<h1>Page not found</h1><p>No such docs page. <a href="/docs">Back to docs</a>.</p>`,
    }),
  );
}

/** Route `/docs` (→ first page) and `/docs/<slug>`. */
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
  res.end(
    layout({
      title: `memorize Hub — ${page.title}`,
      body: `${docsNav(page.slug)}${page.render(origin)}`,
    }),
  );
}
