import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProxyContext } from './proxy.js';
import { layout } from './views.js';

/** Public landing page (`GET /`). Hub-centric, beta-operation focused — no
 * sales/pricing copy. Primary CTA routes to the beta access-request form. */

const BODY = `
<h1>Cross-machine sync for your memorize projects</h1>
<p class="lead">memorize is shared memory for AI coding agents. The Hub relays that
memory between machines that don't share a filesystem — your origin pushes, the
Hub holds, your other machines pull on the next boundary.</p>

<a class="btn" href="/beta">Request beta access</a>

<p class="muted">Sync is in private beta. Request a project-scoped key and an
operator will issue one. See the <a href="/docs">docs</a> to connect, or
memorize itself on <a href="https://github.com/shakystar/memorize">GitHub</a>.</p>

<h2>How it works</h2>
<ol class="steps">
 <li><strong>Request access</strong> for a project at <a href="/beta">/beta</a>.</li>
 <li>An operator <strong>approves</strong> and sends you a one-time, project-scoped API key.</li>
 <li>Point memorize at the Hub with <code>--remote-url</code> and <code>--token</code> on
 each machine — events converge. <a href="/docs">Connect guide →</a></li>
</ol>
`.trim();

export function handleLanding(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: ProxyContext,
): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(layout({ title: 'memorize Hub — cross-machine sync for memorize', body: BODY }));
}
