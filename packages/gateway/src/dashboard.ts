import type { IncomingMessage, ServerResponse } from 'node:http';

import { adminEnabled } from './config.js';
import {
  beginLogin,
  checkState,
  clearStateCookie,
  resolveLogin,
} from './oauth.js';
import type { ProxyContext } from './proxy.js';
import {
  clearOperatorCookie,
  operatorCookie,
  parseCookies,
  readOperator,
} from './session.js';
import {
  approveAccessRequest,
  decideAccessRequest,
  listAccessRequests,
  type AccessRequest,
} from './store.js';

/** Operator dashboard: GitHub-OAuth-gated browser UI over access requests. The
 * mirror of hub-gateway-admin, for humans. Enabled only when OAuth is fully
 * configured (see adminEnabled). */

const MAX_FORM_BYTES = 16 * 1024;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>memorize Hub — operator</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;max-width:48rem;margin:3rem auto;padding:0 1rem;color:#1a1a1a}
 h1{font-size:1.3rem} table{border-collapse:collapse;width:100%;margin-top:1rem}
 th,td{border:1px solid #ddd;padding:.5rem;text-align:left;font-size:.9rem;vertical-align:top}
 th{background:#f6f6f6} button{padding:.35rem .75rem;border:0;border-radius:5px;cursor:pointer;font:inherit}
 .approve{background:#1a7f37;color:#fff} .deny{background:#cf222e;color:#fff}
 form.inline{display:inline} code{background:#f3f3f3;padding:.1rem .3rem;border-radius:4px;word-break:break-all}
 .key{background:#fffbdd;border:1px solid #d4a72c;padding:1rem;border-radius:6px;margin:1rem 0}
 a.btn{display:inline-block;background:#1a1a1a;color:#fff;padding:.5rem 1rem;border-radius:6px;text-decoration:none}
 .muted{color:#666}
</style></head><body>${body}</body></html>`;
}

function send(res: ServerResponse, status: number, html: string, extraHeaders: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(page(html));
}

function redirect(res: ServerResponse, location: string, setCookie?: string | string[]): void {
  const headers: Record<string, string | string[]> = { location };
  if (setCookie) headers['set-cookie'] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_FORM_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

function loginView(): string {
  return `<h1>memorize Hub — operator</h1>
<p class="muted">Sign in with an authorized GitHub account to review beta access requests.</p>
<p><a class="btn" href="/admin/login">Sign in with GitHub</a></p>`;
}

function dashboardView(login: string, pending: AccessRequest[], decided: number): string {
  const rows = pending
    .map(
      (r) => `<tr>
 <td><code>${esc(r.id)}</code></td>
 <td>${esc(r.email)}</td>
 <td><code>${esc(r.requested_project_id)}</code></td>
 <td>${esc(r.note ?? '')}</td>
 <td>
   <form class="inline" method="POST" action="/admin/approve"><input type="hidden" name="requestId" value="${esc(r.id)}"><button class="approve">Approve</button></form>
   <form class="inline" method="POST" action="/admin/deny"><input type="hidden" name="requestId" value="${esc(r.id)}"><button class="deny">Deny</button></form>
 </td>
</tr>`,
    )
    .join('');
  return `<h1>Beta access requests</h1>
<p class="muted">Signed in as <code>${esc(login)}</code> · <a href="/admin/logout">sign out</a> · ${decided} already decided</p>
${
    pending.length === 0
      ? '<p>No pending requests.</p>'
      : `<table><thead><tr><th>id</th><th>email</th><th>project</th><th>note</th><th>action</th></tr></thead><tbody>${rows}</tbody></table>`
  }`;
}

function keyIssuedView(req: AccessRequest, plaintext: string): string {
  return `<h1>Approved</h1>
<p><code>${esc(req.email)}</code> → <code>${esc(req.requested_project_id)}</code></p>
<div class="key"><strong>API key (shown once — copy and send it to the participant):</strong><br><code>${esc(plaintext)}</code></div>
<p><a class="btn" href="/admin">Back to requests</a></p>`;
}

/** Handle every /admin/* route. Caller guarantees the path starts with /admin. */
export async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ProxyContext,
): Promise<void> {
  const { config, db } = ctx;
  if (!adminEnabled(config)) {
    send(res, 503, '<h1>Operator dashboard not configured</h1><p class="muted">Set GITHUB_CLIENT_ID/SECRET, GATEWAY_PUBLIC_URL, GATEWAY_SESSION_SECRET, and GATEWAY_ADMIN_LOGINS.</p>');
    return;
  }
  const secret = config.sessionSecret!;
  const path = url.pathname;

  // --- OAuth entry / return ---
  if (req.method === 'GET' && path === '/admin/login') {
    const { redirectTo, setCookie } = beginLogin(config);
    redirect(res, redirectTo, setCookie);
    return;
  }
  if (req.method === 'GET' && path === '/admin/callback') {
    const cookieState = parseCookies(req.headers.cookie)['hub_oauth_state'];
    if (!checkState(url.searchParams.get('state') ?? undefined, cookieState, secret)) {
      send(res, 403, '<h1>Login failed</h1><p>Invalid state. <a href="/admin/login">Try again</a>.</p>');
      return;
    }
    const code = url.searchParams.get('code');
    const login = code ? await resolveLogin(config, code) : null;
    if (!login || !config.adminLogins.includes(login)) {
      send(res, 403, '<h1>Not authorized</h1><p class="muted">This GitHub account is not an operator.</p>', {
        'set-cookie': clearStateCookie,
      });
      return;
    }
    redirect(res, '/admin', [operatorCookie(login, secret), clearStateCookie]);
    return;
  }
  if (req.method === 'GET' && path === '/admin/logout') {
    redirect(res, '/admin', clearOperatorCookie());
    return;
  }

  // --- Authenticated operator surface ---
  const operator = readOperator(req.headers.cookie, secret);

  if (req.method === 'GET' && (path === '/admin' || path === '/admin/')) {
    if (!operator) {
      send(res, 200, loginView());
      return;
    }
    const pending = listAccessRequests(db, 'pending');
    const decided = listAccessRequests(db, 'approved').length + listAccessRequests(db, 'denied').length;
    send(res, 200, dashboardView(operator.login, pending, decided));
    return;
  }

  if (req.method === 'POST' && (path === '/admin/approve' || path === '/admin/deny')) {
    if (!operator) {
      redirect(res, '/admin');
      return;
    }
    const form = await readForm(req);
    const requestId = form.get('requestId') ?? '';
    if (path === '/admin/approve') {
      const result = approveAccessRequest(db, requestId);
      if (!result) {
        send(res, 404, '<h1>Unknown request</h1><p><a href="/admin">Back</a></p>');
        return;
      }
      send(res, 200, keyIssuedView(result.request, result.plaintext));
      return;
    }
    decideAccessRequest(db, requestId, 'denied');
    redirect(res, '/admin');
    return;
  }

  send(res, 404, '<h1>Not found</h1>');
}
