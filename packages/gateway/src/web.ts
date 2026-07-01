import type { IncomingMessage, ServerResponse } from 'node:http';

import { upsertAccountByGoogle } from './accounts.js';
import {
  approveDevice,
  findPendingByUserCode,
  normalizeUserCode,
  type PendingDevice,
} from './device.js';
import { adminEnabled, sessionLoginEnabled } from './config.js';
import type { GatewayContext } from './context.js';
import { readBody, sendError, sendJson } from './http.js';
import { redeemInvite } from './invites.js';
import { getOrCreatePersonalStore } from './personal-store.js';
import { getStore } from './stores.js';
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
  parseCookies,
  readAccount,
  signValue,
  verifyValue,
  type AccountSession,
} from './session.js';
import {
  gatherBilling,
  gatherOverview,
  listAccounts,
  type AccountBilling,
  type AccountSummary,
  type Billing,
  type Overview,
} from './overview.js';
import {
  cmdBlock,
  copyScript,
  docsLayout,
  docsSidebar,
  htmlEscape,
  layout,
  operatorLayout,
  originFor,
} from './views.js';

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

/** OIDC scopes for account login: verified email + stable sub, plus profile. */
const ACCOUNT_SCOPE = 'openid email profile';

/** Short-lived cookie carrying a pending /join invite token across OAuth login. */
const JOIN_COOKIE = 'hub_join';
function setJoinCookie(token: string): string {
  return `${JOIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`;
}
function clearJoinCookie(): string {
  return `${JOIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

/** Short-lived cookie carrying a local return path across OAuth login (e.g. /device). */
const RETURN_COOKIE = 'hub_return';
function setReturnCookie(path: string): string {
  return `${RETURN_COOKIE}=${encodeURIComponent(path)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`;
}
function clearReturnCookie(): string {
  return `${RETURN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
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
  // Signed-in visitors skip the marketing landing and go straight to the app.
  if (readNavUser(req, ctx)) return redirect(res, '/app');
  const origin = originFor(req, ctx.config);
  const user = null;
  const body = `
<section class="py-8">
 <h1 class="text-4xl font-bold tracking-tight">Cross-machine memory<br>for local-first agents.</h1>
 <p class="mt-4 text-lg prose-muted max-w-2xl">A dumb store-and-forward relay plus a thin control-plane.
  Your project and personal memory, synced across every machine you work on — and
  shared with teammates when you want it.</p>
 <div class="mt-6 flex flex-wrap items-center gap-3">
  <a href="/app" class="btn btn-primary">Open the app</a>
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
  sendHtml(res, 200, layout({ title: 'Memorize Hub', body, user }));
}

/* --------------------------------------------------------------------- docs --- */

interface DocPage {
  slug: string;
  title: string;
  section: string;
  render: (origin: string) => string;
}

const H1 = 'text-2xl font-bold tracking-tight';
const H2 = 'mt-10 text-lg font-semibold';
const P = 'mt-2 text-sm prose-muted';

const DOC_PAGES: DocPage[] = [
  {
    slug: '',
    title: 'Overview',
    section: 'Getting started',
    render: () => `<h1 class="${H1}">Memorize Hub</h1>
<p class="mt-3 text-base prose-muted max-w-2xl">The Hub is the optional relay + control-plane for
 <a href="https://github.com/shakystar/memorize" class="text-accent hover:underline">memorize</a>'s
 cross-machine sync. It holds opaque per-store event logs so your machines — and teammates — converge
 without sharing a filesystem.</p>
<div class="mt-6 grid gap-4 sm:grid-cols-3">
 <div class="card"><h2 class="font-semibold">Personal memory</h2><p class="mt-1 text-sm prose-muted">A private,
  account-scoped store that follows you across machines.</p></div>
 <div class="card"><h2 class="font-semibold">Shared workspaces</h2><p class="mt-1 text-sm prose-muted">Invite
  teammates into one event log; memory becomes the union, tagged by provenance.</p></div>
 <div class="card"><h2 class="font-semibold">Local-first</h2><p class="mt-1 text-sm prose-muted">The relay is
  always optional. Append-only, store-and-forward, self-healing.</p></div>
</div>
<h2 class="${H2}">Two planes</h2>
<p class="${P}">A dumb <strong class="text-fg">relay</strong> stores opaque, append-only event logs keyed only on
 <code class="font-mono">event.id</code>. A thin <strong class="text-fg">gateway</strong> owns identity, keys,
 membership, and invites, and reverse-proxies the relay. They never mix — that is what keeps the relay
 vendor-neutral and your memory schema free to evolve.</p>
<p class="mt-4 text-sm"><a href="/docs/quickstart" class="text-accent hover:underline">Start with the quickstart -&gt;</a></p>`,
  },
  {
    slug: 'quickstart',
    title: 'Quickstart',
    section: 'Getting started',
    render: (o) => `<h1 class="${H1}">Quickstart</h1>
<p class="${P}">Sync a project across two machines in four steps. Needs memorize 2.5.0+.</p>
<h2 class="${H2}">1. Update memorize</h2>
${cmdBlock('memorize update')}
<h2 class="${H2}">2. Get a key</h2>
<p class="${P}">Open the <a href="/app" class="text-accent hover:underline">dashboard</a>, sign in with Google,
 and generate an API key under your account.</p>
<h2 class="${H2}">3. Log in once per machine</h2>
<p class="${P}">Store the key host-wide so later commands carry no inline token.</p>
${cmdBlock(`memorize auth login --remote-url ${o} --token YOUR_KEY`)}
<h2 class="${H2}">4. Sync a project</h2>
<p class="${P}">Use <code class="font-mono">clone</code>, not <code class="font-mono">init</code> —
 <code class="font-mono">init</code> forks a new empty project that will not sync.</p>
${cmdBlock(`memorize project clone PROJECT_ID --remote-url ${o}`)}`,
  },
  {
    slug: 'workspaces',
    title: 'Workspaces',
    section: 'Concepts',
    render: () => `<h1 class="${H1}">Workspaces</h1>
<p class="${P}">A workspace is a shared, multi-account project surface: several accounts each sync their
 project into one shared event log, and every member's local store becomes the union, distinguished by
 provenance. A <strong class="text-fg">private project is the degenerate 1-member case</strong> of the same
 mechanism.</p>
<h2 class="${H2}">Roles</h2>
<p class="${P}">Two roles: <strong class="text-fg">owner</strong> (manages membership, invites, roles, and can
 delete the workspace) and <strong class="text-fg">member</strong> (sync = publish). Owners are equal peers;
 the only guardrail is that the last owner cannot leave while other members remain.</p>
<h2 class="${H2}">Invites</h2>
<p class="${P}">Owners mint a revocable, optionally-expiring, multi-use invite link. The first invite flips a
 private project into a shared workspace. Joining is per-account and authenticated — the link grants
 membership, not raw data access.</p>`,
  },
  {
    slug: 'personal-memory',
    title: 'Personal memory',
    section: 'Concepts',
    render: () => `<h1 class="${H1}">Personal memory</h1>
<p class="${P}">Your global, cross-project memory syncs to a private, account-scoped store. It is never shared,
 never grantable, and reachable only by your own unscoped keys — the privacy boundary is structural, not a
 setting. The client keeps personal-scoped memory out of any workspace push.</p>`,
  },
  {
    slug: 'keys',
    title: 'API keys',
    section: 'Concepts',
    render: () => `<h1 class="${H1}">API keys</h1>
<p class="${P}">Keys authenticate your machines to the Hub. Two orthogonal attributes only ever narrow access:
 <strong class="text-fg">read-only</strong> (pull, never push or mutate) and <strong class="text-fg">scope</strong>
 (a data-plane-only key limited to specific workspaces). An unscoped key syncs personal memory and every
 workspace you belong to; a scoped key reaches neither personal memory nor account management.</p>`,
  },
];

export function handleDocs(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  url: URL,
): void {
  const origin = originFor(req, ctx.config);
  const slug =
    url.pathname === '/docs' || url.pathname === '/docs/'
      ? ''
      : decodeURIComponent(url.pathname.replace(/^\/docs\/?/, ''));
  const links = DOC_PAGES.map((p) => ({ slug: p.slug, title: p.title, section: p.section }));
  const page = DOC_PAGES.find((p) => p.slug === slug);
  if (!page) {
    const content = `<h1 class="${H1}">Not found</h1><p class="${P}">No such docs page. <a href="/docs" class="text-accent hover:underline">Back to docs</a>.</p>`;
    sendHtml(res, 404, docsLayout({ title: 'Memorize Hub — docs', sidebar: docsSidebar(links, ''), content }));
    return;
  }
  const content = `${page.render(origin)}${copyScript()}`;
  sendHtml(res, 200, docsLayout({ title: `Memorize Hub — ${page.title}`, sidebar: docsSidebar(links, slug), content }));
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

  // Single flow: account login. The operator dashboard reuses this session and
  // gates on the admin allowlist at /admin — there is no separate operator login.
  if (!sessionLoginEnabled(config)) {
    sendHtml(res, 503, page('Accounts not configured', ''), { 'set-cookie': clearStateCookie });
    return;
  }
  const resolved = await resolveLogin(config, code);
  if (!resolved) {
    sendHtml(res, 403, page('Login failed', '<p class="prose-muted">Could not read a verified email from your Google account.</p>'), { 'set-cookie': clearStateCookie });
    return;
  }
  const accountId = upsertAccountByGoogle(db, resolved.sub, resolved.email);
  const setCookies = [
    accountCookie({ accountId, email: resolved.email }, secret),
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
  // A device-auth approval (or any pre-login link) stashes a local return path in
  // `hub_return`; honor it (local paths only) instead of dropping the user on /app.
  const pendingReturn = parseCookies(req.headers.cookie)[RETURN_COOKIE];
  if (pendingReturn && pendingReturn.startsWith('/') && !pendingReturn.startsWith('//')) {
    setCookies.push(clearReturnCookie());
    redirect(res, pendingReturn, setCookies);
    return;
  }
  redirect(res, '/app', setCookies);
}

/* ---------------------------------------------------------- account (JSON) --- */

/** GET /account/me — the SPA's "who am I" + personal-store id. 401 if no session. */
export function handleAccountMe(req: IncomingMessage, res: ServerResponse, ctx: GatewayContext): void {
  const secret = ctx.config.sessionSecret;
  const session = secret ? readAccount(req.headers.cookie, secret) : null;
  if (!session) return sendError(res, 401, 'not signed in');
  const personal = getOrCreatePersonalStore(ctx.db, session.accountId);
  sendJson(res, 200, {
    accountId: session.accountId,
    email: session.email,
    personalStoreId: personal.storeId,
  });
}

/* ------------------------------------------------------------------ account --- */

export async function handleAccount(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  url: URL,
): Promise<void> {
  const { config } = ctx;
  // The account UI now lives in the /app SPA. Only the OAuth entry/exit stay here;
  // every other /account path redirects into the app (one UI, no legacy HTML pages).
  if (!sessionLoginEnabled(config)) {
    sendHtml(
      res,
      503,
      page(
        'Accounts not configured',
        '<p class="prose-muted">Set GOOGLE_CLIENT_ID/SECRET, GATEWAY_PUBLIC_URL, and GATEWAY_SESSION_SECRET.</p>',
      ),
    );
    return;
  }
  const path = url.pathname;
  if (req.method === 'GET' && path === '/account/login') {
    const { redirectTo, setCookie } = beginLogin(config, { flow: 'account', scope: ACCOUNT_SCOPE });
    redirect(res, redirectTo, setCookie);
    return;
  }
  if (req.method === 'GET' && path === '/account/logout') {
    redirect(res, '/app', clearAccountCookie());
    return;
  }
  redirect(res, '/app');
}

/* ------------------------------------------------------------------- device --- */

const DEVICE_CSRF_TTL_MS = 10 * 60 * 1000;

/**
 * GET /device — device-authorization approval page (docs/protocol/device-auth.md).
 * Session-gated like /admin: no session -> account login, returning here (code
 * preserved) via `hub_return`. A valid pending user_code shows an Approve form; NO
 * key is minted here — that happens when the client polls after approval.
 */
export function handleDevicePage(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  url: URL,
): void {
  const { config, db } = ctx;
  if (!sessionLoginEnabled(config)) {
    sendHtml(res, 503, page('Device sign-in not configured', ''));
    return;
  }
  const secret = config.sessionSecret!;
  const rawCode = url.searchParams.get('code') ?? '';
  const session = readAccount(req.headers.cookie, secret);
  if (!session) {
    const code = normalizeUserCode(rawCode);
    const back = `/device${code ? `?code=${encodeURIComponent(code)}` : ''}`;
    redirect(res, '/account/login', setReturnCookie(back));
    return;
  }
  const code = normalizeUserCode(rawCode);
  const pending = code ? findPendingByUserCode(db, code, Date.now()) : null;
  if (!pending) {
    sendHtml(res, code ? 404 : 200, deviceEntryPage(session, rawCode, Boolean(code)));
    return;
  }
  const csrf = signValue({ c: pending.userCode, exp: Date.now() + DEVICE_CSRF_TTL_MS }, secret);
  sendHtml(res, 200, deviceApprovePage(session, pending, csrf));
}

/** POST /device — approve the pending request for the signed-in account. */
export async function handleDeviceApprove(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
): Promise<void> {
  const { config, db } = ctx;
  if (!sessionLoginEnabled(config)) {
    sendHtml(res, 503, page('Device sign-in not configured', ''));
    return;
  }
  const secret = config.sessionSecret!;
  const session = readAccount(req.headers.cookie, secret);
  if (!session) return redirect(res, '/account/login');
  let form: URLSearchParams;
  try {
    form = new URLSearchParams((await readBody(req, 4 * 1024)).toString('utf8'));
  } catch {
    return sendHtml(res, 400, page('Bad request', ''));
  }
  const userCode = normalizeUserCode(form.get('user_code') ?? '');
  const csrf = verifyValue<{ c?: string }>(form.get('csrf') ?? '', secret);
  if (!csrf || csrf.c !== userCode) {
    sendHtml(
      res,
      403,
      page('Approval failed', '<p class="prose-muted">Invalid or expired form. Reopen the link shown in your terminal.</p>'),
    );
    return;
  }
  const ok = approveDevice(db, userCode, session.accountId, Date.now());
  sendHtml(res, ok ? 200 : 404, deviceResultPage(session, ok));
}

/** Code-entry / not-found page: a GET form to (re)enter a user code. */
function deviceEntryPage(session: AccountSession, rawCode: string, notFound: boolean): string {
  const msg = notFound
    ? `<p class="mt-2 text-sm text-danger">That code was not found or has expired. Check your terminal and try again.</p>`
    : `<p class="mt-2 text-sm prose-muted">Enter the code shown in your terminal to connect this device.</p>`;
  const body = `<h1 class="text-2xl font-bold tracking-tight">Connect a device</h1>
${msg}
<form method="GET" action="/device" class="mt-5 flex items-center gap-2">
 <input name="code" value="${htmlEscape(rawCode)}" placeholder="XXXX-XXXX" autofocus
  class="rounded-md border border-default bg-canvas-inset px-3 py-2 font-mono uppercase tracking-widest">
 <button type="submit" class="btn btn-primary">Continue</button>
</form>`;
  return layout({ title: 'Memorize Hub — connect a device', body, user: session });
}

/** Approval page: confirm identity + Approve for a valid pending user code. */
function deviceApprovePage(session: AccountSession, pending: PendingDevice, csrf: string): string {
  const body = `<h1 class="text-2xl font-bold tracking-tight">Connect a device</h1>
<p class="mt-2 prose-muted">A device is asking to sign in as
 <strong class="text-fg">${htmlEscape(session.email)}</strong>. Only approve this if you just started a
 login from your own terminal.</p>
<div class="card mt-4"><p class="text-xs uppercase tracking-wide text-fg-subtle">Code</p>
 <p class="mt-1 font-mono text-2xl tracking-widest">${htmlEscape(pending.userCode)}</p></div>
<form method="POST" action="/device" class="mt-5 flex items-center gap-3">
 <input type="hidden" name="user_code" value="${htmlEscape(pending.userCode)}">
 <input type="hidden" name="csrf" value="${htmlEscape(csrf)}">
 <button type="submit" class="btn btn-primary">Approve</button>
 <a href="/app" class="text-sm text-fg-muted hover:text-fg hover:no-underline">Cancel</a>
</form>`;
  return layout({ title: 'Memorize Hub — approve device', body, user: session });
}

/** Post-approval result page. */
function deviceResultPage(session: AccountSession, ok: boolean): string {
  const body = ok
    ? `<h1 class="text-2xl font-bold tracking-tight">Device approved</h1>
<p class="mt-2 prose-muted">Return to your terminal — it will finish signing in automatically. You can
 close this tab.</p>`
    : `<h1 class="text-2xl font-bold tracking-tight">Nothing to approve</h1>
<p class="mt-2 prose-muted">That request was not found or has expired. Start the login again from your
 terminal.</p>`;
  return layout({ title: 'Memorize Hub — device', body, user: session });
}

/* -------------------------------------------------------------------- admin --- */

/**
 * /admin — operator dashboard. Gated by the ACCOUNT session + the admin allowlist
 * (no separate operator login): signed-out -> account login; signed-in but not an
 * operator -> 404 (don't reveal the surface exists); operator -> read-only
 * Overview. Read-only + aggregate only, so there is no mutation/CSRF surface.
 */
export async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: GatewayContext,
  url: URL,
): Promise<void> {
  const { config, db } = ctx;
  if (!adminEnabled(config)) {
    sendHtml(res, 503, page('Operator dashboard not configured', ''));
    return;
  }
  const secret = config.sessionSecret!; // adminEnabled implies session config is set
  const session = readAccount(req.headers.cookie, secret);
  if (!session) {
    // Signed-out — go through the normal account login, then revisit /admin.
    redirect(res, '/account/login');
    return;
  }
  if (!config.adminEmails.includes(session.email)) {
    // Existence-leak policy (policy.ts): a non-operator must not learn /admin exists.
    sendHtml(res, 404, page('Not found', '<p class="prose-muted">Not found.</p>'));
    return;
  }
  // Operator sections share the gate above; dispatch on the sub-path.
  switch (url.pathname) {
    case '/admin':
      sendHtml(res, 200, renderOverview(session, await gatherOverview(db, config)));
      return;
    case '/admin/accounts':
      sendHtml(res, 200, renderAccounts(session, listAccounts(db)));
      return;
    case '/admin/billing':
      sendHtml(res, 200, renderBilling(session, await gatherBilling(db, config)));
      return;
    default:
      sendHtml(res, 404, page('Not found', '<p class="prose-muted">Not found.</p>'));
  }
}

/** Human-readable byte size (one decimal above KB). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function statCard(label: string, value: string, sub?: string): string {
  return `<div class="card">
   <p class="text-xs font-medium uppercase tracking-wide text-fg-subtle">${htmlEscape(label)}</p>
   <p class="mt-1 text-2xl font-semibold tabular-nums">${htmlEscape(value)}</p>
   ${sub ? `<p class="mt-0.5 text-xs text-fg-muted">${htmlEscape(sub)}</p>` : ''}
  </div>`;
}

/** Operator Overview — aggregate, read-only (no key values, no memory contents). */
function renderOverview(session: AccountSession, o: Overview): string {
  const { counts: c, storage: s, traffic: t } = o;
  const num = (n: number): string => n.toLocaleString('en-US');

  const controlPlane = [
    statCard('Accounts', num(c.accounts)),
    statCard(
      'Workspaces',
      num(c.workspacesPrivate + c.workspacesShared),
      `${num(c.workspacesPrivate)} private · ${num(c.workspacesShared)} shared`,
    ),
    statCard('Members', num(c.members)),
    statCard('API keys', num(c.keysActive), `${num(c.keysRevoked)} revoked`),
    statCard('Personal stores', num(c.personalStores)),
  ].join('');

  const trafficCards = [
    statCard('Requests', num(t.requests)),
    statCard('Egress', formatBytes(t.bytesOut)),
    statCard('Ingress', formatBytes(t.bytesIn)),
  ].join('');

  const storageTable =
    s.top.length === 0
      ? ''
      : `<div class="card mt-4 overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="text-left text-fg-subtle">
         <th class="pb-2 font-medium">Store</th>
         <th class="pb-2 text-right font-medium">Events</th>
         <th class="pb-2 text-right font-medium">Size</th>
        </tr></thead>
        <tbody>${s.top
          .map(
            (row) => `<tr class="border-t border-default">
           <td class="py-1.5 font-mono text-xs">${htmlEscape(row.storeId)}</td>
           <td class="py-1.5 text-right tabular-nums">${num(row.events)}</td>
           <td class="py-1.5 text-right tabular-nums">${htmlEscape(formatBytes(row.bytes))}</td>
          </tr>`,
          )
          .join('')}</tbody></table></div>`;

  const storage = s.reachable
    ? `<div class="grid gap-4 sm:grid-cols-3">
        ${statCard('Total stored', formatBytes(s.totals.bytes))}
        ${statCard('Events', num(s.totals.events))}
        ${statCard('Stores', num(s.totals.stores))}
       </div>${storageTable}`
    : `<p class="text-sm text-fg-muted">Relay unreachable — no size snapshot.</p>`;

  const body = `
<div class="flex items-baseline justify-between">
 <h1 class="text-2xl font-bold tracking-tight">Overview</h1>
 <span class="text-xs text-fg-subtle">read-only · aggregate</span>
</div>
<p class="mt-1 text-sm prose-muted">Sizes and counts only, never keys or memory contents.</p>

<h2 class="mt-8 text-lg font-semibold">Control plane</h2>
<div class="mt-3 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">${controlPlane}</div>

<h2 class="mt-8 text-lg font-semibold">Traffic <span class="text-sm font-normal text-fg-subtle">· last ${t.days} days</span></h2>
<div class="mt-3 grid gap-4 sm:grid-cols-3">${trafficCards}</div>

<h2 class="mt-8 text-lg font-semibold">Storage at rest</h2>
<div class="mt-3">${storage}</div>`;

  return operatorLayout({
    title: 'Memorize Hub — Operator',
    email: session.email,
    nav: operatorNav('overview'),
    body,
  });
}

/** The operator section rail — every section is built now, so no `soon` items. */
function operatorNav(active: 'overview' | 'accounts' | 'billing') {
  return [
    { label: 'Overview', href: '/admin', active: active === 'overview' },
    { label: 'Accounts', href: '/admin/accounts', active: active === 'accounts' },
    { label: 'Billing', href: '/admin/billing', active: active === 'billing' },
  ];
}

/** A bare cell class for the operator tables — right-aligned numerics. */
const TD = 'py-1.5 border-t border-default';
const TDNUM = `${TD} text-right tabular-nums`;
const THEAD = 'text-left text-fg-subtle';

/** Operator Accounts list — identity + membership/key counts, read-only. */
function renderAccounts(session: AccountSession, accounts: AccountSummary[]): string {
  const num = (n: number): string => n.toLocaleString('en-US');
  const rows =
    accounts.length === 0
      ? `<tr><td class="${TD} text-fg-muted" colspan="6">No accounts yet.</td></tr>`
      : accounts
          .map(
            (a) => `<tr>
       <td class="${TD}">${htmlEscape(a.email)}</td>
       <td class="${TD} text-fg-muted">${htmlEscape(a.createdAt.slice(0, 10))}</td>
       <td class="${TDNUM}">${num(a.owned)}</td>
       <td class="${TDNUM}">${num(a.joined)}</td>
       <td class="${TDNUM}">${num(a.keysActive)}</td>
       <td class="${TD} text-center">${a.personal ? '✓' : '—'}</td>
      </tr>`,
          )
          .join('');

  const body = `
<div class="flex items-baseline justify-between">
 <h1 class="text-2xl font-bold tracking-tight">Accounts</h1>
 <span class="text-xs text-fg-subtle">${num(accounts.length)} total · read-only</span>
</div>
<p class="mt-1 text-sm prose-muted">Identity and membership counts only — never key values or memory contents.</p>
<div class="card mt-6 overflow-x-auto"><table class="w-full text-sm">
 <thead><tr class="${THEAD}">
  <th class="pb-2 font-medium">Account</th>
  <th class="pb-2 font-medium">Joined</th>
  <th class="pb-2 text-right font-medium">Owned</th>
  <th class="pb-2 text-right font-medium">Member</th>
  <th class="pb-2 text-right font-medium">Keys</th>
  <th class="pb-2 text-center font-medium">Personal</th>
 </tr></thead>
 <tbody>${rows}</tbody>
</table></div>`;

  return operatorLayout({
    title: 'Memorize Hub — Operator · Accounts',
    email: session.email,
    nav: operatorNav('accounts'),
    body,
  });
}

/**
 * Operator Billing seam (H080). Per-account entitlement quantities (workspace
 * count, invite headcount) + cost attribution. No plan enforcement yet — every
 * account is unlimited; this is the surface future free/plus/pro caps attach to.
 */
function renderBilling(session: AccountSession, b: Billing): string {
  const num = (n: number): string => n.toLocaleString('en-US');
  const storedCell = (r: AccountBilling): string =>
    b.relayReachable ? htmlEscape(formatBytes(r.storedBytes)) : '<span class="text-fg-subtle">—</span>';
  const rows =
    b.rows.length === 0
      ? `<tr><td class="${TD} text-fg-muted" colspan="7">No accounts yet.</td></tr>`
      : b.rows
          .map(
            (r) => `<tr>
       <td class="${TD}">${htmlEscape(r.email)}</td>
       <td class="${TD}"><span class="rounded bg-canvas-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-subtle">unlimited</span></td>
       <td class="${TDNUM}">${num(r.workspaces)}</td>
       <td class="${TDNUM}">${num(r.members)}</td>
       <td class="${TDNUM}">${storedCell(r)}</td>
       <td class="${TDNUM}">${htmlEscape(formatBytes(r.egressBytes))}</td>
       <td class="${TDNUM}">${num(r.requests)}</td>
      </tr>`,
          )
          .join('');

  const body = `
<div class="flex items-baseline justify-between">
 <h1 class="text-2xl font-bold tracking-tight">Billing</h1>
 <span class="text-xs text-fg-subtle">last ${b.days} days · read-only</span>
</div>
<div class="card mt-4 border-attention-border bg-attention-subtle">
 <p class="text-sm text-fg">Plan enforcement is not wired — every account is <strong>unlimited</strong>.
  This is the seam: future <strong>free / plus / pro</strong> tiers would cap workspace count and invite
  headcount, and attach here.</p>
</div>
<div class="card mt-4 overflow-x-auto"><table class="w-full text-sm">
 <thead><tr class="${THEAD}">
  <th class="pb-2 font-medium">Account</th>
  <th class="pb-2 font-medium">Plan</th>
  <th class="pb-2 text-right font-medium">Workspaces</th>
  <th class="pb-2 text-right font-medium">Members</th>
  <th class="pb-2 text-right font-medium">Stored</th>
  <th class="pb-2 text-right font-medium">Egress</th>
  <th class="pb-2 text-right font-medium">Requests</th>
 </tr></thead>
 <tbody>${rows}</tbody>
</table></div>
<p class="mt-3 text-xs text-fg-subtle">Workspaces + Members = the future caps. Cost is attributed to each
 store's creator (+ the account's personal store).${b.relayReachable ? '' : ' Stored sizes hidden — relay unreachable.'}</p>`;

  return operatorLayout({
    title: 'Memorize Hub — Operator · Billing',
    email: session.email,
    nav: operatorNav('billing'),
    body,
  });
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
  sendHtml(res, 200, layout({ title: 'Memorize Hub — joined', body, user: session }), {
    'set-cookie': clearJoinCookie(),
  });
}

/* ----------------------------------------------------------------- helpers --- */

/** A minimal standalone page (no signed-in nav state needed). */
function page(title: string, bodyHtml: string): string {
  return layout({ title: `Memorize Hub — ${title}`, body: `<h1 class="text-2xl font-bold">${htmlEscape(title)}</h1>${bodyHtml}` });
}

/** The signed-in account for header nav, if the session cookie is valid. */
function readNavUser(req: IncomingMessage, ctx: GatewayContext): AccountSession | null {
  if (!ctx.config.sessionSecret) return null;
  return readAccount(req.headers.cookie, ctx.config.sessionSecret);
}
