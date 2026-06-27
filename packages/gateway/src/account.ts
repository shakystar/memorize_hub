import type { IncomingMessage, ServerResponse } from 'node:http';

import { participantLoginEnabled } from './config.js';
import { beginLogin, checkState, clearStateCookie, resolveLogin } from './oauth.js';
import type { ProxyContext } from './proxy.js';
import {
  clearParticipantCookie,
  parseCookies,
  participantCookie,
  readParticipant,
  type ParticipantSession,
} from './session.js';
import {
  createAccessRequest,
  issueApiKey,
  listAccessRequestsByEmail,
  listApiTokens,
  listProjectAccess,
  revokeToken,
  tokenBelongsToUser,
  upsertUserByGithub,
  type AccessRequest,
  type ProjectGrant,
  type TokenSummary,
} from './store.js';
import { htmlEscape, layout } from './views.js';

/**
 * Participant self-service surface (/account/*). GitHub login (reusing the
 * gateway's OAuth machinery), then a dashboard where a signed-in user requests
 * project access, and — once an operator approves — mints and revokes their own
 * API keys. Login != ownership: requests still go through operator approval; the
 * dashboard only removes the manual key courier.
 */

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_FORM_BYTES = 16 * 1024;

/** The participant OAuth flow: own callback + cookie path, plus email scope. */
const USER_FLOW = {
  callbackPath: '/account/callback',
  cookiePath: '/account',
  scope: 'read:user user:email',
} as const;

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

function send(
  res: ServerResponse,
  status: number,
  body: string,
  extraHeaders: Record<string, string | string[]> = {},
): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(layout({ title: 'memorize Hub - account', body }));
}

function redirect(res: ServerResponse, location: string, setCookie?: string | string[]): void {
  const headers: Record<string, string | string[]> = { location };
  if (setCookie) headers['set-cookie'] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

// --- views ---

function signedOutView(): string {
  return `<h1>Your account</h1>
<p class="lead">Sign in with GitHub to request project access and manage your sync keys.</p>
<p><a class="btn" href="/account/login">Sign in with GitHub</a></p>
<p class="muted">No GitHub account? You can still <a href="/beta">request access by email</a>.</p>`;
}

function requestsView(requests: AccessRequest[]): string {
  if (requests.length === 0) return '<p class="muted">No access requests yet.</p>';
  const rows = requests
    .map(
      (r) => `<tr><td><code>${htmlEscape(r.requested_project_id)}</code></td>
 <td>${htmlEscape(r.status)}</td><td class="muted">${htmlEscape(r.created_at)}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>project</th><th>status</th><th>requested</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

function projectsView(grants: ProjectGrant[]): string {
  if (grants.length === 0) {
    return '<p class="muted">No approved projects yet. Request access above; an operator will approve it.</p>';
  }
  const rows = grants
    .map(
      (g) => `<tr><td><code>${htmlEscape(g.project_id)}</code></td>
 <td>${htmlEscape(g.role)}</td></tr>`,
    )
    .join('');
  return `<table><thead><tr><th>project</th><th>role</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function keysView(tokens: TokenSummary[]): string {
  if (tokens.length === 0) return '<p class="muted">No keys yet.</p>';
  const rows = tokens
    .map((t) => {
      const status = t.revoked_at
        ? `<span class="muted">revoked</span>`
        : `<form method="POST" action="/account/keys/${htmlEscape(t.id)}/revoke" style="margin:0">
 <button class="submit" style="margin:0;padding:.3rem .7rem">Revoke</button></form>`;
      const used = t.last_used_at ? htmlEscape(t.last_used_at) : 'never';
      return `<tr><td><code>${htmlEscape(t.prefix)}…</code></td>
 <td>${htmlEscape(t.label ?? '')}</td><td class="muted">${used}</td><td>${status}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>key</th><th>label</th><th>last used</th><th></th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

function dashboardView(
  ctx: ProxyContext,
  session: ParticipantSession,
  flash: { notice?: string; issuedKey?: string } = {},
): string {
  const { db } = ctx;
  const grants = listProjectAccess(db, session.userId);
  const tokens = listApiTokens(db, session.userId);
  const requests = listAccessRequestsByEmail(db, session.email);
  const canIssue = grants.length > 0;

  const issued = flash.issuedKey
    ? `<div style="background:#fffbdd;border:1px solid #d4a72c;padding:1rem;border-radius:8px;margin:1rem 0">
 <strong>New API key — copy it now, it is shown only once:</strong><br>
 <code>${htmlEscape(flash.issuedKey)}</code></div>`
    : '';
  const notice = flash.notice ? `<p class="lead">${flash.notice}</p>` : '';

  return `<h1>Your account</h1>
<p class="muted">Signed in as <code>${htmlEscape(session.login)}</code>
 (<code>${htmlEscape(session.email)}</code>) / <a href="/account/logout">sign out</a></p>
${notice}${issued}

<h2>Request project access</h2>
<p class="muted">Enter the project id you want to sync. An operator approves access before any key works.</p>
<form method="POST" action="/account/requests">
 <label for="project">Project id</label>
 <input id="project" name="projectId" required placeholder="proj_..."
  pattern="[A-Za-z0-9_-]{1,128}">
 <label for="note">Note <span class="muted">(optional)</span></label>
 <textarea id="note" name="note" rows="2" placeholder="Which machines? What for?"></textarea>
 <button class="submit" type="submit">Request access</button>
</form>
<h2>Your requests</h2>
${requestsView(requests)}

<h2>Your projects</h2>
${projectsView(grants)}

<h2>Your API keys</h2>
${keysView(tokens)}
${
    canIssue
      ? `<form method="POST" action="/account/keys">
 <button class="submit" type="submit">Generate a new key</button></form>
 <p class="muted">One key authenticates all your approved projects. Present it as
 <code>Authorization: Bearer &lt;key&gt;</code>.</p>`
      : '<p class="muted">Once a request is approved you can generate a key here.</p>'
  }`;
}

// --- handler ---

/** Handle every /account/* route. Caller guarantees the path starts with /account. */
export async function handleAccount(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ProxyContext,
): Promise<void> {
  const { config, db } = ctx;
  if (!participantLoginEnabled(config)) {
    send(res, 503, '<h1>Accounts not configured</h1><p class="muted">Set GITHUB_CLIENT_ID/SECRET, GATEWAY_PUBLIC_URL, and GATEWAY_SESSION_SECRET.</p>');
    return;
  }
  const secret = config.sessionSecret!;
  const path = url.pathname;

  // --- OAuth entry / return ---
  if (req.method === 'GET' && path === '/account/login') {
    const { redirectTo, setCookie } = beginLogin(config, USER_FLOW);
    redirect(res, redirectTo, setCookie);
    return;
  }
  if (req.method === 'GET' && path === '/account/callback') {
    const cookieState = parseCookies(req.headers.cookie)['hub_oauth_state'];
    if (!checkState(url.searchParams.get('state') ?? undefined, cookieState, secret)) {
      send(res, 403, '<h1>Login failed</h1><p>Invalid state. <a href="/account/login">Try again</a>.</p>');
      return;
    }
    const code = url.searchParams.get('code');
    const resolved = code
      ? await resolveLogin(config, code, { callbackPath: USER_FLOW.callbackPath, fetchEmail: true })
      : null;
    if (!resolved || !resolved.email) {
      send(res, 403, '<h1>Login failed</h1><p class="muted">Could not read your GitHub identity.</p>', {
        'set-cookie': clearStateCookie(USER_FLOW.cookiePath),
      });
      return;
    }
    const userId = upsertUserByGithub(db, resolved.login, resolved.email);
    redirect(res, '/account', [
      participantCookie({ userId, login: resolved.login, email: resolved.email }, secret),
      clearStateCookie(USER_FLOW.cookiePath),
    ]);
    return;
  }
  if (req.method === 'GET' && path === '/account/logout') {
    redirect(res, '/account', clearParticipantCookie());
    return;
  }

  // --- authenticated participant surface ---
  const session = readParticipant(req.headers.cookie, secret);

  if (req.method === 'GET' && (path === '/account' || path === '/account/')) {
    if (!session) {
      send(res, 200, signedOutView());
      return;
    }
    send(res, 200, dashboardView(ctx, session));
    return;
  }

  if (!session) {
    redirect(res, '/account');
    return;
  }

  if (req.method === 'POST' && path === '/account/requests') {
    const form = await readForm(req).catch(() => null);
    const projectId = (form?.get('projectId') ?? '').trim();
    const note = (form?.get('note') ?? '').trim();
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      send(res, 400, dashboardView(ctx, session, {
        notice: 'A project id like <code>proj_...</code> is required.',
      }));
      return;
    }
    createAccessRequest(db, session.email, projectId, note || undefined);
    send(res, 201, dashboardView(ctx, session, {
      notice: `Request for <code>${htmlEscape(projectId)}</code> is pending operator approval.`,
    }));
    return;
  }

  if (req.method === 'POST' && path === '/account/keys') {
    // A key authenticates the user across all their grants; only issue once the
    // user actually holds at least one approved project.
    if (listProjectAccess(db, session.userId).length === 0) {
      send(res, 403, dashboardView(ctx, session, {
        notice: 'No approved projects yet — request access first.',
      }));
      return;
    }
    const { plaintext } = issueApiKey(db, session.userId, session.login);
    send(res, 201, dashboardView(ctx, session, { issuedKey: plaintext }));
    return;
  }

  const revokeMatch = /^\/account\/keys\/([^/]+)\/revoke$/.exec(path);
  if (req.method === 'POST' && revokeMatch) {
    const tokenId = decodeURIComponent(revokeMatch[1]!);
    if (!tokenBelongsToUser(db, tokenId, session.userId)) {
      send(res, 403, dashboardView(ctx, session, { notice: 'That key is not yours.' }));
      return;
    }
    revokeToken(db, tokenId);
    send(res, 200, dashboardView(ctx, session, { notice: 'Key revoked.' }));
    return;
  }

  send(res, 404, '<h1>Not found</h1>');
}
