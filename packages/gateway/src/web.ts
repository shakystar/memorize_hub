import type { IncomingMessage, ServerResponse } from 'node:http';

import { upsertAccountByGithub } from './accounts.js';
import { adminEnabled, sessionLoginEnabled } from './config.js';
import type { GatewayContext } from './context.js';
import { sendError, sendJson } from './http.js';
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
  type AccountSession,
} from './session.js';
import { gatherOverview, type Overview } from './overview.js';
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
  sendHtml(res, 200, layout({ title: 'memorize Hub', body, user }));
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
    render: () => `<h1 class="${H1}">memorize Hub</h1>
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
<p class="${P}">Open the <a href="/app" class="text-accent hover:underline">dashboard</a>, sign in with GitHub,
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
    sendHtml(res, 404, docsLayout({ title: 'memorize Hub — docs', sidebar: docsSidebar(links, ''), content }));
    return;
  }
  const content = `${page.render(origin)}${copyScript()}`;
  sendHtml(res, 200, docsLayout({ title: `memorize Hub — ${page.title}`, sidebar: docsSidebar(links, slug), content }));
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
    login: session.login,
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
        '<p class="prose-muted">Set GITHUB_CLIENT_ID/SECRET, GATEWAY_PUBLIC_URL, and GATEWAY_SESSION_SECRET.</p>',
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
  _url: URL,
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
  if (!config.adminLogins.includes(session.login)) {
    // Existence-leak policy (policy.ts): a non-operator must not learn /admin exists.
    sendHtml(res, 404, page('Not found', '<p class="prose-muted">Not found.</p>'));
    return;
  }
  const overview = await gatherOverview(db, config);
  sendHtml(res, 200, renderOverview(session, overview));
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
    title: 'memorize Hub — Operator',
    login: session.login,
    nav: [
      { label: 'Overview', href: '/admin', active: true },
      { label: 'Accounts', href: null },
      { label: 'Billing', href: null },
    ],
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
