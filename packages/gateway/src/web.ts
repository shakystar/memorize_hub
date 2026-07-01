import type { IncomingMessage, ServerResponse } from 'node:http';

import { upsertAccountByGithub } from './accounts.js';
import { adminEnabled, sessionLoginEnabled } from './config.js';
import type { GatewayContext } from './context.js';
import { readBody } from './http.js';
import {
  issueApiKey,
  listAccountTokens,
  revokeToken,
  tokenBelongsToAccount,
  type TokenSummary,
} from './keys.js';
import { getOrCreatePersonalStore } from './personal-store.js';
import {
  beginLogin,
  clearStateCookie,
  resolveLogin,
  STATE_COOKIE_NAME,
  verifyCallback,
} from './oauth.js';
import {
  accountCookie,
  clearAccountCookie,
  operatorCookie,
  parseCookies,
  readAccount,
  type AccountSession,
} from './session.js';
import { cmdBlock, copyScript, htmlEscape, layout, originFor } from './views.js';

/**
 * Browser (session) surfaces (docs/protocol/README.md §6): `/` landing, `/docs`,
 * `/account` (self-service, GitHub OAuth), `/admin` (operator, allowlist-gated),
 * `/join` (invite landing), and the shared `/oauth/callback`. These use the OAuth
 * account session, not an API key.
 *
 * @remarks S1 slice — web shell + login. `/account` shows signed-in identity +
 * personal-store discovery; key issuance (S2), workspace list (S3), `/join` (S4),
 * and `/admin` (S5) land in later slices.
 */

/** Account login asks for the email scope so we attach a verified email. */
const ACCOUNT_SCOPE = 'read:user user:email';

function sendHtml(
  res: ServerResponse,
  status: number,
  html: string,
  extraHeaders: Record<string, string | string[]> = {},
): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, setCookie?: string | string[]): void {
  const headers: Record<string, string | string[]> = { location };
  if (setCookie) headers['set-cookie'] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

/* ------------------------------------------------------------------ landing --- */

export function handleLanding(req: IncomingMessage, res: ServerResponse, ctx: GatewayContext): void {
  const origin = originFor(req, ctx.config);
  const user = readNavUser(req, ctx);
  const body = `
<section class="py-8">
 <h1 class="text-4xl font-bold tracking-tight">Cross-machine memory<br>for local-first agents.</h1>
 <p class="mt-4 text-lg prose-muted max-w-2xl">A dumb store-and-forward relay plus a thin control-plane.
  Your project and personal memory, synced across every machine you work on — and
  shared with teammates when you want it.</p>
 <div class="mt-6 flex flex-wrap items-center gap-3">
  <a href="/account" class="btn btn-primary">Get started</a>
  <a href="/docs" class="text-accent hover:underline">Read the docs -&gt;</a>
 </div>
</section>

<section class="mt-6">
 <p class="text-sm prose-muted mb-1">Connect a machine once, then clone any project token-free:</p>
 ${cmdBlock(`memorize auth login --remote-url ${origin} --token YOUR_KEY`)}
</section>

<section class="mt-14 grid gap-4 sm:grid-cols-3">
 <div class="card">
  <h2 class="font-semibold">Personal memory</h2>
  <p class="mt-1 text-sm prose-muted">A private, account-scoped store that follows you
   across machines. Never shared, never grantable.</p>
 </div>
 <div class="card">
  <h2 class="font-semibold">Shared workspaces</h2>
  <p class="mt-1 text-sm prose-muted">Invite teammates into one event log; each member's
   memory becomes the union, tagged by provenance.</p>
 </div>
 <div class="card">
  <h2 class="font-semibold">Local-first</h2>
  <p class="mt-1 text-sm prose-muted">The relay is always optional. Sync is
   store-and-forward and append-only — outages self-heal, never lose data.</p>
 </div>
</section>
${copyScript()}`;
  sendHtml(res, 200, layout({ title: 'memorize Hub', body, user }));
}

/* --------------------------------------------------------------------- docs --- */

export function handleDocs(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  _url: URL,
): void {
  const user = readNavUser(_req, ctx);
  const origin = originFor(_req, ctx.config);
  const body = `
<h1 class="text-2xl font-bold">Docs</h1>
<p class="mt-2 prose-muted">Getting started with the memorize Hub. Full guides land as
 the control-plane rebuild ships; this is the quickstart.</p>

<h2 class="mt-8 text-lg font-semibold">1. Update memorize</h2>
<p class="mt-1 text-sm prose-muted">Host login + token-free clone need memorize 2.5.0+.</p>
${cmdBlock('memorize update')}

<h2 class="mt-8 text-lg font-semibold">2. Get a key</h2>
<p class="mt-1 text-sm prose-muted">Sign in at <a href="/account" class="text-accent hover:underline">/account</a>
 with GitHub and generate an API key.</p>

<h2 class="mt-8 text-lg font-semibold">3. Log in once per machine</h2>
${cmdBlock(`memorize auth login --remote-url ${origin} --token YOUR_KEY`)}

<h2 class="mt-8 text-lg font-semibold">4. Sync a project</h2>
<p class="mt-1 text-sm prose-muted">Use <code class="font-mono">clone</code>, not
 <code class="font-mono">init</code> — <code class="font-mono">init</code> forks a new
 empty project that will not sync.</p>
${cmdBlock(`memorize project clone PROJECT_ID --remote-url ${origin}`)}
${copyScript()}`;
  sendHtml(res, 200, layout({ title: 'memorize Hub — docs', body, user, wide: true }));
}

/* ---------------------------------------------------------- oauth callback --- */

export async function handleOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  url: URL,
): Promise<void> {
  const { config, db } = ctx;
  if (!config.sessionSecret) {
    sendHtml(res, 503, page('Login not configured', '<p class="prose-muted">OAuth is not set up on this Hub.</p>'));
    return;
  }
  const secret = config.sessionSecret;

  const cookieState = parseCookies(req.headers.cookie)[STATE_COOKIE_NAME];
  const state = verifyCallback(url.searchParams.get('state') ?? undefined, cookieState, secret);
  if (!state) {
    sendHtml(res, 403, page('Login failed', '<p class="prose-muted">Invalid state. <a class="text-accent hover:underline" href="/account">Try again</a>.</p>'), { 'set-cookie': clearStateCookie });
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    sendHtml(res, 400, page('Login failed', '<p class="prose-muted">Missing authorization code.</p>'), { 'set-cookie': clearStateCookie });
    return;
  }

  if (state.flow === 'admin') {
    if (!adminEnabled(config)) {
      sendHtml(res, 503, page('Operator dashboard not configured', ''), { 'set-cookie': clearStateCookie });
      return;
    }
    const resolved = await resolveLogin(config, code);
    if (!resolved || !config.adminLogins.includes(resolved.login)) {
      sendHtml(res, 403, page('Not authorized', '<p class="prose-muted">This GitHub account is not an operator.</p>'), { 'set-cookie': clearStateCookie });
      return;
    }
    redirect(res, '/admin', [operatorCookie(resolved.login, secret), clearStateCookie]);
    return;
  }

  // account flow
  if (!sessionLoginEnabled(config)) {
    sendHtml(res, 503, page('Accounts not configured', ''), { 'set-cookie': clearStateCookie });
    return;
  }
  const resolved = await resolveLogin(config, code, { fetchEmail: true });
  if (!resolved || !resolved.email) {
    sendHtml(res, 403, page('Login failed', '<p class="prose-muted">Could not read a verified email from your GitHub account.</p>'), { 'set-cookie': clearStateCookie });
    return;
  }
  const accountId = upsertAccountByGithub(db, resolved.login, resolved.email);
  redirect(res, '/account', [
    accountCookie({ accountId, login: resolved.login, email: resolved.email }, secret),
    clearStateCookie,
  ]);
}

/* ------------------------------------------------------------------ account --- */

export async function handleAccount(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  url: URL,
): Promise<void> {
  const { config, db } = ctx;
  if (!sessionLoginEnabled(config)) {
    sendHtml(res, 503, page(
      'Accounts not configured',
      '<p class="prose-muted">Set <code class="font-mono">GITHUB_CLIENT_ID</code>/<code class="font-mono">SECRET</code>, <code class="font-mono">GATEWAY_PUBLIC_URL</code>, and <code class="font-mono">GATEWAY_SESSION_SECRET</code>.</p>',
    ));
    return;
  }
  const secret = config.sessionSecret!;
  const path = url.pathname;
  const origin = originFor(req, config);

  if (req.method === 'GET' && path === '/account/login') {
    const { redirectTo, setCookie } = beginLogin(config, { flow: 'account', scope: ACCOUNT_SCOPE });
    redirect(res, redirectTo, setCookie);
    return;
  }
  if (req.method === 'GET' && path === '/account/logout') {
    redirect(res, '/account', clearAccountCookie());
    return;
  }

  const session = readAccount(req.headers.cookie, secret);
  if (req.method === 'GET' && (path === '/account' || path === '/account/')) {
    const body = session ? signedInView(ctx, session, origin) : signedOutView();
    sendHtml(res, 200, layout({ title: 'memorize Hub — account', body, user: session }));
    return;
  }

  // Authenticated mutations below.
  if (!session) {
    redirect(res, '/account');
    return;
  }

  // Mint a new API key. In S2 keys are unscoped (they reach personal memory and,
  // once granted, every workspace); a read-only checkbox is the only narrowing.
  // Per-workspace scoping arrives with the workspace UI (S3).
  if (req.method === 'POST' && path === '/account/keys') {
    const form = await readForm(req).catch(() => null);
    const readOnly = form?.get('readonly') === '1';
    const { plaintext } = issueApiKey(db, session.accountId, session.login, { readOnly });
    const body = signedInView(ctx, session, origin, { issuedKey: plaintext });
    sendHtml(res, 201, layout({ title: 'memorize Hub — account', body, user: session }));
    return;
  }

  const revokeMatch = /^\/account\/keys\/([^/]+)\/revoke$/.exec(path);
  if (req.method === 'POST' && revokeMatch) {
    const tokenId = decodeURIComponent(revokeMatch[1]!);
    if (!tokenBelongsToAccount(db, tokenId, session.accountId)) {
      const body = signedInView(ctx, session, origin, { notice: 'That key is not yours.' });
      sendHtml(res, 403, layout({ title: 'memorize Hub — account', body, user: session }));
      return;
    }
    revokeToken(db, tokenId);
    const body = signedInView(ctx, session, origin, { notice: 'Key revoked.' });
    sendHtml(res, 200, layout({ title: 'memorize Hub — account', body, user: session }));
    return;
  }

  sendHtml(res, 404, page('Not found', ''));
}

function signedOutView(): string {
  return `<h1 class="text-2xl font-bold">Your account</h1>
<p class="mt-2 prose-muted max-w-xl">Sign in with GitHub to create workspaces, invite
 teammates, and mint the API keys your machines sync with.</p>
<p class="mt-6"><a class="btn btn-primary" href="/account/login">Sign in with GitHub</a></p>`;
}

interface AccountFlash {
  /** A freshly minted key, shown exactly once. */
  issuedKey?: string;
  /** A one-line status message (revoke, error). */
  notice?: string;
}

function signedInView(
  ctx: GatewayContext,
  session: AccountSession,
  origin: string,
  flash: AccountFlash = {},
): string {
  const personal = getOrCreatePersonalStore(ctx.db, session.accountId);
  const tokens = listAccountTokens(ctx.db, session.accountId);
  const notice = flash.notice
    ? `<p class="mt-4 rounded-md border border-default bg-canvas-subtle px-4 py-2 text-sm">${flash.notice}</p>`
    : '';
  const issued = flash.issuedKey
    ? `<div class="mt-4 rounded-lg border border-attention-border bg-attention-subtle p-4">
 <p class="text-sm font-semibold">New API key — copy it now, it is shown only once:</p>
 <code class="mt-2 block overflow-x-auto whitespace-nowrap rounded-md border border-default bg-canvas-inset px-3 py-2 text-sm font-mono">${htmlEscape(flash.issuedKey)}</code>
 <p class="mt-3 text-sm prose-muted">Log in once per host with it, then clone token-free:</p>
 ${cmdBlock(`memorize auth login --remote-url ${origin} --token ${flash.issuedKey}`)}
</div>`
    : '';

  return `<div class="flex items-center justify-between gap-4">
 <h1 class="text-2xl font-bold">Your account</h1>
 <a href="/account/logout" class="text-sm text-fg-muted hover:text-fg hover:no-underline">Sign out</a>
</div>
<p class="mt-1 text-sm prose-muted">Signed in as <code class="font-mono">@${htmlEscape(session.login)}</code>
 (<code class="font-mono">${htmlEscape(session.email)}</code>)</p>
${notice}${issued}

<h2 class="mt-8 text-lg font-semibold">Personal memory</h2>
<div class="card mt-2">
 <p class="text-sm prose-muted">Your global, cross-project memory syncs to this
  account-scoped store. It is <strong class="text-fg">private</strong> — no other account,
  project, or workspace can reach it, and it is never grantable. Any unscoped key syncs it.</p>
 <p class="mt-3 text-sm">Personal store id: <code class="font-mono">${htmlEscape(personal.storeId)}</code></p>
</div>

<h2 class="mt-8 text-lg font-semibold">API keys</h2>
${keysView(tokens)}
${generateKeyForm()}

<h2 class="mt-8 text-lg font-semibold">Connect a machine</h2>
<p class="mt-1 text-sm prose-muted">Generate a key above, then log in once per host and
 clone token-free. Use <code class="font-mono">clone</code>, not
 <code class="font-mono">init</code> — <code class="font-mono">init</code> forks a new empty
 project that will not sync. Requires memorize 2.5.0+.</p>
${cmdBlock(`memorize auth login --remote-url ${origin} --token YOUR_KEY`)}
${cmdBlock(`memorize project clone PROJECT_ID --remote-url ${origin}`)}
${copyScript()}`;
}

/** The account's keys as a table, each with a revoke action. */
function keysView(tokens: TokenSummary[]): string {
  if (tokens.length === 0) return '<p class="mt-2 text-sm prose-muted">No keys yet.</p>';
  const rows = tokens
    .map((t) => {
      const status = t.revokedAt
        ? '<span class="text-fg-muted">revoked</span>'
        : `<form method="POST" action="/account/keys/${htmlEscape(t.id)}/revoke" class="m-0">
 <button class="btn text-sm">Revoke</button></form>`;
      const used = t.lastUsedAt ? htmlEscape(t.lastUsedAt) : 'never';
      const ro = t.readOnly ? ' <span class="text-fg-muted">(read-only)</span>' : '';
      const scope = t.scopes.length === 0 ? 'all stores' : t.scopes.map(htmlEscape).join(', ');
      return `<tr class="border-t border-default">
 <td class="py-2 pr-4"><code class="font-mono">${htmlEscape(t.prefix)}…</code>${ro}</td>
 <td class="py-2 pr-4 text-fg-muted">${htmlEscape(t.label ?? '')}</td>
 <td class="py-2 pr-4 text-fg-muted">${scope}</td>
 <td class="py-2 pr-4 text-fg-muted">${used}</td>
 <td class="py-2">${status}</td></tr>`;
    })
    .join('');
  return `<div class="mt-2 overflow-x-auto"><table class="w-full text-sm">
 <thead><tr class="text-left text-fg-muted">
  <th class="pb-1 pr-4 font-medium">key</th><th class="pb-1 pr-4 font-medium">label</th>
  <th class="pb-1 pr-4 font-medium">scope</th><th class="pb-1 pr-4 font-medium">last used</th>
  <th class="pb-1 font-medium"></th></tr></thead>
 <tbody>${rows}</tbody></table></div>`;
}

/** The mint-a-key form. S2: unscoped only, with an optional read-only toggle. */
function generateKeyForm(): string {
  return `<form method="POST" action="/account/keys" class="mt-4">
 <p class="text-sm prose-muted">Mint a key for your machines. An unscoped key syncs your
  personal memory and every workspace you belong to.</p>
 <label class="mt-3 flex items-center gap-2 text-sm">
  <input type="checkbox" name="readonly" value="1"> read-only key (pull only)</label>
 <button class="btn btn-primary mt-3" type="submit">Generate a new key</button>
</form>`;
}

/* -------------------------------------------------------------------- admin --- */

/** /admin[/...] — operator dashboard (session + allowlist). Built in S5. */
export function handleAdmin(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  _url: URL,
): void {
  if (!adminEnabled(ctx.config)) {
    sendHtml(res, 503, page('Operator dashboard not configured', ''));
    return;
  }
  sendHtml(res, 200, page('Operator dashboard', '<p class="prose-muted">Coming soon.</p>'));
}

/** GET /join?token=… — human invite landing. Built in S4. */
export function handleJoinPage(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  _url: URL,
): void {
  if (!sessionLoginEnabled(ctx.config)) {
    sendHtml(res, 503, page('Accounts not configured', ''));
    return;
  }
  sendHtml(res, 200, page('Join a workspace', '<p class="prose-muted">Invite redemption coming soon.</p>'));
}

/* ----------------------------------------------------------------- helpers --- */

/** A minimal standalone page (no signed-in nav state needed). */
function page(title: string, bodyHtml: string): string {
  return layout({ title: `memorize Hub — ${title}`, body: `<h1 class="text-2xl font-bold">${htmlEscape(title)}</h1>${bodyHtml}` });
}

/** The signed-in account for header nav, if the session cookie is valid. */
function readNavUser(req: IncomingMessage, ctx: GatewayContext): AccountSession | null {
  if (!ctx.config.sessionSecret) return null;
  return readAccount(req.headers.cookie, ctx.config.sessionSecret);
}

const MAX_FORM_BYTES = 16 * 1024;

/** Parse an `application/x-www-form-urlencoded` POST body (bounded). */
async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const body = await readBody(req, MAX_FORM_BYTES);
  return new URLSearchParams(body.toString('utf8'));
}
