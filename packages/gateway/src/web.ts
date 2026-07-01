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
import { mintInvite as dalMintInvite, redeemInvite } from './invites.js';
import { getOrCreatePersonalStore } from './personal-store.js';
import {
  createStore,
  getStore,
  listAccountStores,
  memberRole,
  removeMember as dalRemoveMember,
  type AccountStore,
} from './stores.js';
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

/** Short-lived cookie carrying a pending /join invite token across OAuth login. */
const JOIN_COOKIE = 'hub_join';
function setJoinCookie(token: string): string {
  return `${JOIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`;
}
function clearJoinCookie(): string {
  return `${JOIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

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
  const setCookies = [
    accountCookie({ accountId, login: resolved.login, email: resolved.email }, secret),
    clearStateCookie,
  ];
  // A login started from a /join link stashes the invite token in `hub_join`; on
  // return, resume the join instead of dropping the user on a bare /account.
  const pendingJoin = parseCookies(req.headers.cookie)[JOIN_COOKIE];
  if (pendingJoin) {
    setCookies.push(clearJoinCookie());
    redirect(res, `/join?token=${encodeURIComponent(pendingJoin)}`, setCookies);
    return;
  }
  redirect(res, '/account', setCookies);
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

  // --- GET section pages (settings sidebar) ---
  if (req.method === 'GET' && (path === '/account' || path === '/account/')) {
    if (!session) {
      sendHtml(res, 200, layout({ title: 'memorize Hub — account', body: signedOutView() }));
      return;
    }
    sendAccount(res, 200, session, 'overview', overviewSection(ctx, session, origin));
    return;
  }
  if (req.method === 'GET' && path === '/account/workspaces') {
    if (!session) return redirect(res, '/account');
    sendAccount(res, 200, session, 'workspaces', workspacesSection(ctx, session));
    return;
  }
  if (req.method === 'GET' && path === '/account/keys') {
    if (!session) return redirect(res, '/account');
    sendAccount(res, 200, session, 'keys', keysSection(ctx, session, origin));
    return;
  }

  // --- authenticated mutations (each re-renders its own section) ---
  if (!session) {
    redirect(res, '/account');
    return;
  }

  // Create a workspace (owner, sole member, private until first invite).
  if (req.method === 'POST' && path === '/account/workspaces') {
    const form = await readForm(req).catch(() => null);
    const nameRaw = (form?.get('name') ?? '').trim();
    if (nameRaw.length > 200) {
      const content = workspacesSection(ctx, session, { notice: 'Name must be at most 200 characters.' });
      return sendAccount(res, 400, session, 'workspaces', content);
    }
    createStore(db, session.accountId, nameRaw.length > 0 ? nameRaw : undefined);
    const notice = nameRaw ? `Workspace “${htmlEscape(nameRaw)}” created.` : 'Workspace created.';
    return sendAccount(res, 201, session, 'workspaces', workspacesSection(ctx, session, { notice }));
  }

  // Mint a new API key. No workspaces checked -> an unscoped key (personal memory +
  // every workspace). Checking specific workspaces -> a data-plane-only scoped key.
  if (req.method === 'POST' && path === '/account/keys') {
    const form = await readForm(req).catch(() => null);
    const readOnly = form?.get('readonly') === '1';
    const owned = new Set(listAccountStores(db, session.accountId).map((s) => s.storeId));
    const storeIds = (form?.getAll('stores') ?? []).filter((s) => owned.has(s));
    const opts = storeIds.length > 0 ? { readOnly, storeIds } : { readOnly };
    const { plaintext } = issueApiKey(db, session.accountId, session.login, opts);
    return sendAccount(res, 201, session, 'keys', keysSection(ctx, session, origin, { issuedKey: plaintext }));
  }

  // Mint an invite for a workspace the account owns; show the join URL once.
  const inviteMatch = /^\/account\/workspaces\/([^/]+)\/invite$/.exec(path);
  if (req.method === 'POST' && inviteMatch) {
    const storeId = decodeURIComponent(inviteMatch[1]!);
    if (memberRole(db, storeId, session.accountId) !== 'owner') {
      const content = workspacesSection(ctx, session, { notice: 'Only an owner can invite.' });
      return sendAccount(res, 403, session, 'workspaces', content);
    }
    const minted = dalMintInvite(db, storeId, session.accountId, {});
    const joinUrl = `${origin}/join?token=${encodeURIComponent(minted.token)}`;
    return sendAccount(res, 201, session, 'workspaces', workspacesSection(ctx, session, { inviteJoinUrl: joinUrl }));
  }

  // Leave a workspace (self-leave). The last owner must transfer or delete first.
  const leaveMatch = /^\/account\/workspaces\/([^/]+)\/leave$/.exec(path);
  if (req.method === 'POST' && leaveMatch) {
    const storeId = decodeURIComponent(leaveMatch[1]!);
    const result = dalRemoveMember(db, storeId, session.accountId);
    if (!result.ok && result.reason === 'last_owner') {
      const content = workspacesSection(ctx, session, {
        notice: 'You are the last owner — transfer ownership or delete the workspace first.',
      });
      return sendAccount(res, 409, session, 'workspaces', content);
    }
    const notice = result.ok ? 'Left the workspace.' : 'You are not a member of that workspace.';
    return sendAccount(res, 200, session, 'workspaces', workspacesSection(ctx, session, { notice }));
  }

  const revokeMatch = /^\/account\/keys\/([^/]+)\/revoke$/.exec(path);
  if (req.method === 'POST' && revokeMatch) {
    const tokenId = decodeURIComponent(revokeMatch[1]!);
    if (!tokenBelongsToAccount(db, tokenId, session.accountId)) {
      const content = keysSection(ctx, session, origin, { notice: 'That key is not yours.' });
      return sendAccount(res, 403, session, 'keys', content);
    }
    revokeToken(db, tokenId);
    return sendAccount(res, 200, session, 'keys', keysSection(ctx, session, origin, { notice: 'Key revoked.' }));
  }

  sendHtml(res, 404, page('Not found', ''));
}

/** Render a section inside the account settings shell (sidebar + content). */
function sendAccount(
  res: ServerResponse,
  status: number,
  session: AccountSession,
  active: AccountTab,
  content: string,
): void {
  const body = accountShell(session, active, content);
  sendHtml(res, status, layout({ title: 'memorize Hub — account', body, user: session, wide: true }));
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
  /** A freshly minted invite join URL, shown once for sharing. */
  inviteJoinUrl?: string;
  /** A one-line status message (revoke, leave, error). */
  notice?: string;
}

type AccountTab = 'overview' | 'workspaces' | 'keys';

/** The settings shell: a left sidebar of sections + the active section content. */
function accountShell(session: AccountSession, active: AccountTab, content: string): string {
  const item = (href: string, label: string, key: AccountTab): string => {
    const cls =
      active === key
        ? 'bg-canvas-subtle font-semibold text-fg'
        : 'text-fg-muted hover:bg-canvas-subtle hover:text-fg hover:no-underline';
    return `<a href="${href}" class="block rounded-md px-3 py-2 text-sm ${cls}">${label}</a>`;
  };
  return `<div class="grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)]">
 <aside>
  <h1 class="px-3 text-xl font-bold">Account</h1>
  <p class="mb-3 px-3 text-xs text-fg-muted">@${htmlEscape(session.login)}</p>
  <nav class="space-y-0.5">
   ${item('/account', 'Overview', 'overview')}
   ${item('/account/workspaces', 'Workspaces', 'workspaces')}
   ${item('/account/keys', 'API keys', 'keys')}
  </nav>
 </aside>
 <div class="min-w-0">${content}</div>
</div>`;
}

function noticeBox(msg: string): string {
  return `<p class="mt-4 rounded-md border border-default bg-canvas-subtle px-4 py-2 text-sm">${msg}</p>`;
}
function issuedKeyBox(origin: string, key: string): string {
  return `<div class="mt-4 rounded-lg border border-attention-border bg-attention-subtle p-4">
 <p class="text-sm font-semibold">New API key — copy it now, it is shown only once:</p>
 <code class="mt-2 block overflow-x-auto whitespace-nowrap rounded-md border border-default bg-canvas-inset px-3 py-2 text-sm font-mono">${htmlEscape(key)}</code>
 <p class="mt-3 text-sm prose-muted">Log in once per host with it, then clone token-free:</p>
 ${cmdBlock(`memorize auth login --remote-url ${origin} --token ${key}`)}
</div>`;
}
function inviteBox(joinUrl: string): string {
  return `<div class="mt-4 rounded-lg border border-attention-border bg-attention-subtle p-4">
 <p class="text-sm font-semibold">Invite link — anyone with it can join as a member:</p>
 ${cmdBlock(joinUrl)}
</div>`;
}

/** Overview: identity, personal memory, connect-a-machine quickstart. */
function overviewSection(ctx: GatewayContext, session: AccountSession, origin: string): string {
  const personal = getOrCreatePersonalStore(ctx.db, session.accountId);
  return `<h2 class="text-xl font-bold">Overview</h2>
<p class="mt-1 text-sm prose-muted">Signed in as <code class="font-mono">@${htmlEscape(session.login)}</code>
 (<code class="font-mono">${htmlEscape(session.email)}</code>).</p>

<h3 class="mt-8 text-base font-semibold">Personal memory</h3>
<div class="card mt-2">
 <p class="text-sm prose-muted">Your global, cross-project memory syncs to this
  account-scoped store. It is <strong class="text-fg">private</strong> — no other account,
  project, or workspace can reach it, and it is never grantable. Any unscoped key syncs it.</p>
 <p class="mt-3 text-sm">Personal store id: <code class="font-mono">${htmlEscape(personal.storeId)}</code></p>
</div>

<h3 class="mt-8 text-base font-semibold">Connect a machine</h3>
<p class="mt-1 text-sm prose-muted"><a href="/account/keys" class="text-accent hover:underline">Generate a key</a>,
 then log in once per host and clone token-free. Use <code class="font-mono">clone</code>, not
 <code class="font-mono">init</code> — <code class="font-mono">init</code> forks a new empty project
 that will not sync. Requires memorize 2.5.0+.</p>
${cmdBlock(`memorize auth login --remote-url ${origin} --token YOUR_KEY`)}
${cmdBlock(`memorize project clone PROJECT_ID --remote-url ${origin}`)}
${copyScript()}`;
}

/** Workspaces: the list + create form (+ invite/leave flash). */
function workspacesSection(
  ctx: GatewayContext,
  session: AccountSession,
  flash: AccountFlash = {},
): string {
  const workspaces = listAccountStores(ctx.db, session.accountId);
  const notice = flash.notice ? noticeBox(flash.notice) : '';
  const invite = flash.inviteJoinUrl ? inviteBox(flash.inviteJoinUrl) : '';
  return `<h2 class="text-xl font-bold">Workspaces</h2>
<p class="mt-1 text-sm prose-muted">A workspace with one member is a private project; invite
 someone and it becomes a shared, union-synced store.</p>
${notice}${invite}
${workspacesView(workspaces)}
<h3 class="mt-8 text-base font-semibold">Create a workspace</h3>
${createWorkspaceForm()}
${copyScript()}`;
}

/** API keys: the list + generate form (+ issued-key flash). */
function keysSection(
  ctx: GatewayContext,
  session: AccountSession,
  origin: string,
  flash: AccountFlash = {},
): string {
  const tokens = listAccountTokens(ctx.db, session.accountId);
  const workspaces = listAccountStores(ctx.db, session.accountId);
  const notice = flash.notice ? noticeBox(flash.notice) : '';
  const issued = flash.issuedKey ? issuedKeyBox(origin, flash.issuedKey) : '';
  return `<h2 class="text-xl font-bold">API keys</h2>
<p class="mt-1 text-sm prose-muted">Keys authenticate your machines. An unscoped key syncs
 personal memory and every workspace; a scoped key is limited to the workspaces you pick.</p>
${notice}${issued}
${keysView(tokens)}
<h3 class="mt-8 text-base font-semibold">Generate a key</h3>
${generateKeyForm(workspaces)}
${copyScript()}`;
}

/**
 * The account's ACTIVE keys as a table, each with a revoke action. Revoked keys
 * are hidden from the list (their row is kept in the DB for security/audit, and
 * the server rejects them at auth) — revoke is a soft-delete, not a row deletion.
 */
function keysView(tokens: TokenSummary[]): string {
  const active = tokens.filter((t) => !t.revokedAt);
  if (active.length === 0) return '<p class="mt-2 text-sm prose-muted">No active keys yet.</p>';
  const rows = active
    .map((t) => {
      const revoke = `<form method="POST" action="/account/keys/${htmlEscape(t.id)}/revoke" class="m-0">
 <button class="btn text-sm">Revoke</button></form>`;
      const used = t.lastUsedAt ? htmlEscape(t.lastUsedAt) : 'never';
      const ro = t.readOnly ? ' <span class="text-fg-muted">(read-only)</span>' : '';
      const scope = t.scopes.length === 0 ? 'all stores' : t.scopes.map(htmlEscape).join(', ');
      return `<tr class="border-t border-default">
 <td class="py-2 pr-4"><code class="font-mono">${htmlEscape(t.prefix)}…</code>${ro}</td>
 <td class="py-2 pr-4 text-fg-muted">${htmlEscape(t.label ?? '')}</td>
 <td class="py-2 pr-4 text-fg-muted">${scope}</td>
 <td class="py-2 pr-4 text-fg-muted">${used}</td>
 <td class="py-2">${revoke}</td></tr>`;
    })
    .join('');
  return `<div class="mt-2 overflow-x-auto"><table class="w-full text-sm">
 <thead><tr class="text-left text-fg-muted">
  <th class="pb-1 pr-4 font-medium">key</th><th class="pb-1 pr-4 font-medium">label</th>
  <th class="pb-1 pr-4 font-medium">scope</th><th class="pb-1 pr-4 font-medium">last used</th>
  <th class="pb-1 font-medium"></th></tr></thead>
 <tbody>${rows}</tbody></table></div>`;
}

/** The account's workspaces (private + shared) as a table. */
function workspacesView(workspaces: AccountStore[]): string {
  if (workspaces.length === 0) {
    return '<p class="mt-2 text-sm prose-muted">No workspaces yet. Create one below — a workspace with one member is just a private project.</p>';
  }
  const rows = workspaces
    .map((w) => {
      const kind = w.inviteReachable
        ? `<span class="text-fg-muted">shared</span>`
        : `<span class="text-fg-muted">private</span>`;
      const name = w.name ? htmlEscape(w.name) : '<span class="text-fg-muted">—</span>';
      const role = w.role === 'owner' ? '<span class="text-fg">owner</span>' : 'member';
      const id = htmlEscape(w.storeId);
      const invite =
        w.role === 'owner'
          ? `<form method="POST" action="/account/workspaces/${id}/invite" class="inline m-0">
   <button class="btn text-sm">Invite</button></form>`
          : '';
      const leave = `<form method="POST" action="/account/workspaces/${id}/leave" class="inline m-0">
   <button class="btn text-sm">Leave</button></form>`;
      return `<tr class="border-t border-default">
 <td class="py-2 pr-4">${name}</td>
 <td class="py-2 pr-4"><code class="font-mono">${id}</code></td>
 <td class="py-2 pr-4">${role}</td>
 <td class="py-2 pr-4">${kind}</td>
 <td class="py-2 pr-4 text-fg-muted">${w.memberCount}</td>
 <td class="py-2"><div class="flex gap-2">${invite}${leave}</div></td></tr>`;
    })
    .join('');
  return `<div class="mt-2 overflow-x-auto"><table class="w-full text-sm">
 <thead><tr class="text-left text-fg-muted">
  <th class="pb-1 pr-4 font-medium">name</th><th class="pb-1 pr-4 font-medium">workspace id</th>
  <th class="pb-1 pr-4 font-medium">role</th><th class="pb-1 pr-4 font-medium">kind</th>
  <th class="pb-1 pr-4 font-medium">members</th><th class="pb-1 font-medium"></th></tr></thead>
 <tbody>${rows}</tbody></table></div>`;
}

/** Create-a-workspace form (optional display name). */
function createWorkspaceForm(): string {
  return `<form method="POST" action="/account/workspaces" class="mt-4 flex flex-wrap items-end gap-3">
 <div>
  <label class="block text-sm prose-muted" for="ws-name">Name <span class="text-fg-subtle">(optional)</span></label>
  <input id="ws-name" name="name" maxlength="200" placeholder="e.g. team-notes"
   class="mt-1 rounded-md border border-default bg-canvas px-3 py-1.5 text-sm">
 </div>
 <button class="btn btn-primary" type="submit">Create workspace</button>
</form>`;
}

/**
 * The mint-a-key form. An unscoped key (no boxes checked) syncs personal memory +
 * every workspace; checking specific workspaces mints a data-plane-only scoped key
 * (no personal memory). A read-only toggle is orthogonal.
 */
function generateKeyForm(workspaces: AccountStore[]): string {
  const boxes = workspaces
    .map(
      (w) => `<label class="flex items-center gap-2 text-sm">
  <input type="checkbox" name="stores" value="${htmlEscape(w.storeId)}">
  <code class="font-mono">${htmlEscape(w.storeId)}</code>${w.name ? ` <span class="text-fg-muted">(${htmlEscape(w.name)})</span>` : ''}</label>`,
    )
    .join('');
  const scopeBlock = workspaces.length
    ? `<div class="mt-3 space-y-1">
  <p class="text-sm prose-muted">Scope to specific workspaces (leave all unchecked for an
   unscoped key that also syncs personal memory). A scoped key never reaches personal memory.</p>
  ${boxes}</div>`
    : '';
  return `<form method="POST" action="/account/keys" class="mt-4">
 <p class="text-sm prose-muted">Mint a key for your machines.</p>
 ${scopeBlock}
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

/**
 * GET /join?token=… — human invite landing. No session -> stash the token and go
 * through GitHub login (the callback resumes here). With a session -> redeem the
 * invite exactly as POST /v1/workspaces/join, then show a success page.
 */
export function handleJoinPage(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  url: URL,
): void {
  const { config, db } = ctx;
  if (!sessionLoginEnabled(config)) {
    sendHtml(res, 503, page('Accounts not configured', ''));
    return;
  }
  const token = url.searchParams.get('token') ?? '';
  if (!token) {
    sendHtml(res, 400, page('Invalid invite', '<p class="prose-muted">This join link is missing its token.</p>'));
    return;
  }

  const session = readAccount(req.headers.cookie, config.sessionSecret!);
  if (!session) {
    // Stash the token, then log in; the OAuth callback returns to /join?token=…
    const { redirectTo, setCookie } = beginLogin(config, { flow: 'account', scope: ACCOUNT_SCOPE });
    redirect(res, redirectTo, [setJoinCookie(token), setCookie]);
    return;
  }

  const result = redeemInvite(db, token, session.accountId);
  if (!result.ok) {
    sendHtml(res, 403, page(
      'Invite not valid',
      '<p class="prose-muted">This invite is unknown, revoked, expired, or fully used. Ask the workspace owner for a fresh link.</p>',
    ), { 'set-cookie': clearJoinCookie() });
    return;
  }
  const store = getStore(db, result.storeId);
  const name = store?.name ? htmlEscape(store.name) : result.storeId;
  const origin = originFor(req, config);
  const verb = result.alreadyMember ? 'You are already a member of' : 'You joined';
  const body = `<h1 class="text-2xl font-bold">Workspace joined</h1>
<p class="mt-2 prose-muted">${verb} <strong class="text-fg">${name}</strong>
 (<code class="font-mono">${htmlEscape(result.storeId)}</code>).</p>
<p class="mt-4 text-sm prose-muted">Generate a key on your <a href="/account" class="text-accent hover:underline">account</a>,
 log in once per machine, then bind a local folder to this workspace to start syncing shared memory:</p>
${cmdBlock(`memorize auth login --remote-url ${origin} --token YOUR_KEY`)}
<p class="mt-4"><a href="/account" class="btn btn-primary">Go to your account</a></p>
${copyScript()}`;
  sendHtml(res, 200, layout({ title: 'memorize Hub — joined', body, user: session }), {
    'set-cookie': clearJoinCookie(),
  });
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
