import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProxyContext } from './proxy.js';
import { layout } from './views.js';

/** Public landing page (`GET /`). Hub-centric, beta-operation focused - no
 * sales/pricing copy. Primary CTA routes to /account sign-in (the /beta email
 * form remains a no-login fallback). */

const BODY = `
<h1>Cross-machine sync for your memorize projects</h1>
<p class="lead">memorize is shared memory for AI coding agents. The Hub relays that
memory between machines that don't share a filesystem - your origin pushes, the
Hub holds, your other machines pull on the next boundary.</p>

<a class="btn" href="/account">Sign in to get started</a>

<p class="muted"><strong>New to memorize?</strong>
<a href="/docs/getting-started">Install it first -></a> (your AI assistant can do
it in one step), then sign in to request a key and sync across machines. Sync is in
private beta; access is project-scoped. No GitHub account?
<a href="/beta">Request by email -></a>. <a href="/docs">Docs</a> /
<a href="https://github.com/shakystar/memorize">memorize on GitHub</a>.</p>

<h2>How it works</h2>
<ol class="steps">
 <li><strong>Sign in</strong> with GitHub and <strong>request access</strong> for a
 project at <a href="/account">/account</a>.</li>
 <li>An operator <strong>approves</strong> your project (sign-in proves who you are,
 not which projects you own).</li>
 <li><strong>Generate your key</strong> in /account, then run <code>memorize auth login</code>
 once per machine (memorize 2.5.0+) - after that, <code>clone</code> and <code>sync</code> carry
 no token and events converge. <a href="/docs">Connect guide -></a></li>
</ol>
`.trim();

export function handleLanding(
  _req: IncomingMessage,
  res: ServerResponse,
  _ctx: ProxyContext,
): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(layout({ title: 'memorize Hub - cross-machine sync for memorize', body: BODY }));
}
