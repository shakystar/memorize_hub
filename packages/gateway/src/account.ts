import type { IncomingMessage, ServerResponse } from 'node:http';

import { participantLoginEnabled } from './config.js';
import { beginLogin } from './oauth.js';
import type { ProxyContext } from './proxy.js';
import {
  clearParticipantCookie,
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
  type AccessRequest,
  type IssueKeyOptions,
  type ProjectGrant,
  type TokenSummary,
} from './store.js';
import { htmlEscape, layout, originFor } from './views.js';

/**
 * Participant self-service surface (/account/*). GitHub login (reusing the
 * gateway's OAuth machinery), then a dashboard where a signed-in user requests
 * project access, and — once an operator approves — mints and revokes their own
 * API keys. Login != ownership: requests still go through operator approval; the
 * dashboard only removes the manual key courier.
 */

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_FORM_BYTES = 16 * 1024;

/** Participant login asks for the email scope so we can attach a verified email. */
const PARTICIPANT_SCOPE = 'read:user user:email';

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

/** A non-secret placeholder safe to paste into a shell (no angle brackets). */
const KEY_PLACEHOLDER = 'YOUR_KEY';

function cloneCommand(origin: string, projectId: string): string {
  return `memorize project clone ${projectId} --remote-url ${origin}`;
}

/** One-time host login (#192, git-credential model): authenticate once, then
 * clone/sync carry no inline --token. A real key is embedded when shown once;
 * otherwise a placeholder the user replaces. */
function authLoginCommand(origin: string, token: string): string {
  return `memorize auth login --remote-url ${origin} --token ${token}`;
}

/** A copy-to-clipboard command row (button reads the sibling code's textContent). */
function cmdBlock(cmd: string): string {
  return `<div style="display:flex;gap:.5rem;align-items:center;margin:.4rem 0">
 <code style="flex:1;overflow-x:auto;white-space:nowrap;padding:.5rem .6rem">${htmlEscape(cmd)}</code>
 <button type="button" class="copy" style="padding:.35rem .8rem;border:0;border-radius:6px;cursor:pointer;font:inherit">copy</button></div>`;
}

/** Per-machine onboarding (#192 git-credential model): authenticate the host
 * once (`auth login`), then clone each project token-free. `token` embeds a
 * real key in the login command (shown once); otherwise a placeholder the user
 * replaces. Always nudges `clone` over `init` (the fork footgun). */
function connectView(grants: ProjectGrant[], origin: string, token?: string): string {
  if (grants.length === 0) return '';
  const key = token ?? KEY_PLACEHOLDER;
  const login = cmdBlock(authLoginCommand(origin, key));
  const clones = grants.map((g) => cmdBlock(cloneCommand(origin, g.project_id))).join('');
  const note = token
    ? `<p class="muted">On another machine: log in once with the key above, then clone each
 project (no token needed). Use <code>clone</code>, never <code>init</code> -
 <code>init</code> forks a new empty project that will not sync.</p>`
    : `<p class="muted">Log in once per host (replace <code>${KEY_PLACEHOLDER}</code> with a key -
 Generate one below), then clone each project (no token needed). Use <code>clone</code>,
 never <code>init</code> - <code>init</code> forks a new empty project that will not sync.</p>`;
  const reqNote = `<p class="muted"><em>Requires memorize 2.5.0+ - run <code>memorize update</code> first.</em></p>`;
  return `<h2>Connect a machine</h2>${note}${reqNote}
<p class="muted"><strong>1. Log in once (per host):</strong></p>${login}
<p class="muted"><strong>2. Clone each project:</strong></p>${clones}`;
}

const COPY_SCRIPT = `<script>
document.addEventListener('click',function(e){
 var b=e.target;
 if(b&&b.classList&&b.classList.contains('copy')){
  var c=b.previousElementSibling;
  if(c&&navigator.clipboard){navigator.clipboard.writeText(c.textContent).then(function(){
   var t=b.textContent;b.textContent='copied';setTimeout(function(){b.textContent=t},1200);});}
 }
});
</script>`;

function keysView(tokens: TokenSummary[]): string {
  if (tokens.length === 0) return '<p class="muted">No keys yet.</p>';
  const rows = tokens
    .map((t) => {
      const status = t.revoked_at
        ? `<span class="muted">revoked</span>`
        : `<form method="POST" action="/account/keys/${htmlEscape(t.id)}/revoke" style="margin:0">
 <button class="submit" style="margin:0;padding:.3rem .7rem">Revoke</button></form>`;
      const used = t.last_used_at ? htmlEscape(t.last_used_at) : 'never';
      const ro = t.readOnly ? ' <span class="muted">(read-only)</span>' : '';
      const scope =
        t.scopes.length === 0
          ? 'all projects'
          : t.scopes.map((p) => htmlEscape(p)).join(', ');
      return `<tr><td><code>${htmlEscape(t.prefix)}…</code>${ro}</td>
 <td>${htmlEscape(t.label ?? '')}</td><td class="muted">${scope}</td>
 <td class="muted">${used}</td><td>${status}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>key</th><th>label</th><th>scope</th><th>last used</th><th></th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

/** The Generate-key form: scope checkboxes (all checked by default) + read-only. */
function generateKeyForm(grants: ProjectGrant[]): string {
  const boxes = grants
    .map(
      (g) => `<label style="font-weight:400;margin:.2rem 0">
 <input type="checkbox" name="projects" value="${htmlEscape(g.project_id)}" checked style="width:auto">
 <code>${htmlEscape(g.project_id)}</code> <span class="muted">(${htmlEscape(g.role)})</span></label>`,
    )
    .join('');
  return `<form method="POST" action="/account/keys">
 <p class="muted">Scope the key to specific projects (all selected = full access) and
 optionally make it read-only. A key never exceeds your role on a project.</p>
 ${boxes}
 <label style="font-weight:400;margin:.4rem 0">
  <input type="checkbox" name="readonly" value="1" style="width:auto"> read-only key (pull only)</label>
 <button class="submit" type="submit">Generate a new key</button>
</form>`;
}

function dashboardView(
  ctx: ProxyContext,
  session: ParticipantSession,
  origin: string,
  flash: { notice?: string; issuedKey?: string; issuedScope?: string[] } = {},
): string {
  const { db } = ctx;
  const grants = listProjectAccess(db, session.userId);
  const tokens = listApiTokens(db, session.userId);
  const requests = listAccessRequestsByEmail(db, session.email);
  const canIssue = grants.length > 0;

  // A freshly minted key is shown once — alongside ready-to-paste clone commands
  // for the projects the key actually covers (its scope, or all if unscoped).
  const covered =
    flash.issuedScope && flash.issuedScope.length > 0
      ? grants.filter((g) => flash.issuedScope!.includes(g.project_id))
      : grants;
  const issued = flash.issuedKey
    ? `<div style="background:#fffbdd;border:1px solid #d4a72c;padding:1rem;border-radius:8px;margin:1rem 0">
 <strong>New API key — copy it now, it is shown only once:</strong><br>
 <code>${htmlEscape(flash.issuedKey)}</code>
 ${covered.length > 0 ? `<div style="margin-top:.8rem">${connectView(covered, origin, flash.issuedKey)}</div>` : ''}</div>`
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

${connectView(grants, origin)}

<h2>Your API keys</h2>
${keysView(tokens)}
${
    canIssue
      ? generateKeyForm(grants)
      : '<p class="muted">Once a request is approved you can generate a key here.</p>'
  }${COPY_SCRIPT}`;
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
  // Hub origin baked into the copy-ready clone commands (config.publicUrl in prod).
  const origin = originFor(req, config);

  // --- OAuth entry / return ---
  // The return leg is the shared /oauth/callback (see oauth-callback.ts).
  if (req.method === 'GET' && path === '/account/login') {
    const { redirectTo, setCookie } = beginLogin(config, {
      flow: 'participant',
      scope: PARTICIPANT_SCOPE,
    });
    redirect(res, redirectTo, setCookie);
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
    send(res, 200, dashboardView(ctx, session, origin));
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
      send(res, 400, dashboardView(ctx, session, origin, {
        notice: 'A project id like <code>proj_...</code> is required.',
      }));
      return;
    }
    createAccessRequest(db, session.email, projectId, note || undefined);
    send(res, 201, dashboardView(ctx, session, origin, {
      notice: `Request for <code>${htmlEscape(projectId)}</code> is pending operator approval.`,
    }));
    return;
  }

  if (req.method === 'POST' && path === '/account/keys') {
    const grants = listProjectAccess(db, session.userId);
    // Only issue once the user actually holds at least one approved project.
    if (grants.length === 0) {
      send(res, 403, dashboardView(ctx, session, origin, {
        notice: 'No approved projects yet — request access first.',
      }));
      return;
    }
    const form = await readForm(req).catch(() => null);
    const readOnly = form?.get('readonly') === '1';
    // Keep only checked projects the user actually holds; selecting all (or none)
    // means an unscoped key that covers every current grant.
    const grantIds = new Set(grants.map((g) => g.project_id));
    const selected = (form?.getAll('projects') ?? []).filter((p) => grantIds.has(p));
    const scopeAll = selected.length === 0 || selected.length === grantIds.size;
    const opts: IssueKeyOptions = { readOnly };
    if (!scopeAll) opts.projectIds = selected;
    const { plaintext } = issueApiKey(db, session.userId, session.login, opts);
    const flash: { issuedKey: string; issuedScope?: string[] } = { issuedKey: plaintext };
    if (!scopeAll) flash.issuedScope = selected;
    send(res, 201, dashboardView(ctx, session, origin, flash));
    return;
  }

  const revokeMatch = /^\/account\/keys\/([^/]+)\/revoke$/.exec(path);
  if (req.method === 'POST' && revokeMatch) {
    const tokenId = decodeURIComponent(revokeMatch[1]!);
    if (!tokenBelongsToUser(db, tokenId, session.userId)) {
      send(res, 403, dashboardView(ctx, session, origin, { notice: 'That key is not yours.' }));
      return;
    }
    revokeToken(db, tokenId);
    send(res, 200, dashboardView(ctx, session, origin, { notice: 'Key revoked.' }));
    return;
  }

  send(res, 404, '<h1>Not found</h1>');
}
