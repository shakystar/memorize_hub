import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProxyContext } from './proxy.js';
import { createAccessRequest } from './store.js';

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

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>memorize Hub — beta access</title>
<style>
 body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}
 h1{font-size:1.4rem} label{display:block;margin:1rem 0 .25rem;font-weight:600}
 input,textarea{width:100%;padding:.5rem;border:1px solid #bbb;border-radius:6px;font:inherit;box-sizing:border-box}
 button{margin-top:1.25rem;padding:.6rem 1.2rem;border:0;border-radius:6px;background:#1a1a1a;color:#fff;font:inherit;cursor:pointer}
 .muted{color:#666;font-size:.9rem} code{background:#f3f3f3;padding:.1rem .3rem;border-radius:4px}
</style></head><body>${body}</body></html>`;
}

const FORM = page(`
<h1>memorize Hub — request beta access</h1>
<p class="muted">The Hub relays memorize's cross-machine sync. Request access to a
project and an operator will issue you a project-scoped API key.</p>
<form method="POST" action="/beta/requests">
 <label for="email">Email</label>
 <input id="email" name="email" type="email" required placeholder="you@example.com">
 <label for="project">Project id</label>
 <input id="project" name="projectId" required placeholder="proj_…">
 <label for="note">Note <span class="muted">(optional)</span></label>
 <textarea id="note" name="note" rows="3" placeholder="Which machines? What for?"></textarea>
 <button type="submit">Request access</button>
</form>`);

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
  res.end(page(body));
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
    `<h1>Request received</h1><p>Thanks — your request <code>${id}</code> for ` +
      `<code>${projectId}</code> is pending operator approval. You'll receive an ` +
      `API key by email.</p>`,
  );
}
