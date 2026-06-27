import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProxyContext } from './proxy.js';
import { createAccessRequest } from './store.js';
import { htmlEscape, layout } from './views.js';

/** Public beta access-request surface. No auth — anyone may request; an operator
 * approves manually via hub-gateway-admin. */

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_FORM_BYTES = 16 * 1024;

// Naive per-IP rate limit: at most N submissions per window. In-memory only —
// adequate for a small beta behind a single gateway process.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

const FORM = layout({
  title: 'memorize Hub — beta access',
  body: `
<h1>Request beta access</h1>
<p class="muted">The Hub relays memorize's cross-machine sync. Request access to a
project and an operator will issue you a project-scoped API key.</p>
<form method="POST" action="/beta/requests">
 <label for="email">Email</label>
 <input id="email" name="email" type="email" required placeholder="you@example.com">
 <label for="project">Project id</label>
 <input id="project" name="projectId" required placeholder="proj_…">
 <label for="note">Note <span class="muted">(optional)</span></label>
 <textarea id="note" name="note" rows="3" placeholder="Which machines? What for?"></textarea>
 <button class="submit" type="submit">Request access</button>
</form>`,
});

export function handleBetaPage(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(FORM);
}

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_FORM_BYTES) {
        reject(Object.assign(new Error('too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

function reply(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(layout({ title: 'memorize Hub — beta access', body }));
}

export async function handleBetaSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProxyContext,
): Promise<void> {
  const ip = req.socket.remoteAddress ?? 'unknown';
  if (rateLimited(ip, Date.now())) {
    reply(res, 429, '<h1>Slow down</h1><p>Too many requests. Try again later.</p>');
    return;
  }

  let form: URLSearchParams;
  try {
    form = await readForm(req);
  } catch {
    reply(res, 413, '<h1>Request too large</h1>');
    return;
  }

  const email = (form.get('email') ?? '').trim();
  const projectId = (form.get('projectId') ?? '').trim();
  const note = (form.get('note') ?? '').trim();

  if (!EMAIL_PATTERN.test(email) || !PROJECT_ID_PATTERN.test(projectId)) {
    reply(
      res,
      400,
      '<h1>Check your details</h1><p>A valid email and a project id like ' +
        '<code>proj_…</code> are required. <a href="/beta">Back</a></p>',
    );
    return;
  }

  const id = createAccessRequest(ctx.db, email, projectId, note || undefined);
  reply(
    res,
    201,
    `<h1>Request received</h1><p>Thanks — your request <code>${htmlEscape(id)}</code> for ` +
      `<code>${htmlEscape(projectId)}</code> is pending operator approval. You'll receive an ` +
      `API key by email.</p>`,
  );
}
