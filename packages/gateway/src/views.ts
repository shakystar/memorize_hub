import type { IncomingMessage } from 'node:http';

import type { GatewayConfig } from './config.js';

/**
 * Shared HTML shell for the Hub's server-rendered pages (landing, docs, account).
 * Styling is Tailwind v4 built to a static /assets/app.css, themed with GitHub
 * Primer design tokens (see the web-UI decision). Pages pass a pre-rendered,
 * trusted HTML body; this wraps it in the header/nav + footer chrome.
 */

const GITHUB_URL = 'https://github.com/shakystar/memorize';

/** Shared <head>: charset/viewport, fonts (Inter + JetBrains Mono), the built CSS. */
function pageHead(title: string): string {
  return `<!doctype html><html lang="en" class="bg-canvas text-fg"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/app.css">
</head>`;
}

export interface NavUser {
  /** GitHub login of the signed-in account, shown in the header. */
  login: string;
  /** Verified email, shown in the account dropdown (optional). */
  email?: string;
}

export interface LayoutOptions {
  title: string;
  /** Pre-rendered, trusted HTML for the page body. */
  body: string;
  /** The signed-in account, if any — swaps the header's Account link for a menu. */
  user?: NavUser | null;
  /** Widen the shell — used by the docs + settings layouts. */
  wide?: boolean;
}

/** The header account control: an avatar that opens a native <details> dropdown. */
function accountMenu(user: NavUser | null | undefined): string {
  if (!user) {
    return `<a href="/app" class="text-fg-muted hover:text-fg hover:no-underline">Open app</a>`;
  }
  const avatar = `https://github.com/${encodeURIComponent(user.login)}.png?size=48`;
  const email = user.email
    ? `<div class="truncate text-xs text-fg-muted">${htmlEscape(user.email)}</div>`
    : '';
  return `<details class="relative">
 <summary class="flex items-center gap-2">
  <img src="${avatar}" alt="@${htmlEscape(user.login)}" width="28" height="28"
   class="h-7 w-7 rounded-full border border-default bg-canvas-subtle">
 </summary>
 <div class="shadow-menu absolute right-0 z-20 mt-2 w-60 rounded-lg border border-default bg-canvas p-1">
  <div class="px-3 py-2">
   <div class="text-sm font-semibold">@${htmlEscape(user.login)}</div>${email}
  </div>
  <div class="my-1 border-t border-default"></div>
  <a href="/account" class="block rounded-md px-3 py-1.5 text-sm hover:bg-canvas-subtle hover:no-underline">Overview</a>
  <a href="/account/workspaces" class="block rounded-md px-3 py-1.5 text-sm hover:bg-canvas-subtle hover:no-underline">Workspaces</a>
  <a href="/account/keys" class="block rounded-md px-3 py-1.5 text-sm hover:bg-canvas-subtle hover:no-underline">API keys</a>
  <div class="my-1 border-t border-default"></div>
  <a href="/account/logout" class="block rounded-md px-3 py-1.5 text-sm text-danger hover:bg-canvas-subtle hover:no-underline">Sign out</a>
 </div>
</details>`;
}

/** Wrap a page body in the shared shell: sticky header nav + main + footer. */
export function layout({ title, body, user, wide = false }: LayoutOptions): string {
  const container = wide ? 'max-w-5xl' : 'max-w-3xl';
  return `${pageHead(title)}<body class="min-h-screen bg-canvas text-fg antialiased">
<header class="border-b border-default">
 <div class="${container} mx-auto flex items-center justify-between gap-4 px-5 py-3">
  <a href="/" class="font-semibold text-fg hover:no-underline">memorize <span class="text-fg-muted">Hub</span></a>
  <nav class="flex items-center gap-5 text-sm">
   <a href="/docs" class="text-fg-muted hover:text-fg hover:no-underline">Docs</a>
   <a href="${GITHUB_URL}" class="text-fg-muted hover:text-fg hover:no-underline">GitHub</a>
   ${accountMenu(user)}
  </nav>
 </div>
</header>
<main class="${container} mx-auto px-5 py-10">${body}</main>
<footer class="border-t border-default mt-16">
 <div class="${container} mx-auto px-5 py-8 text-sm text-fg-muted">
  <p>memorize Hub — the optional relay + control-plane for
   <a href="${GITHUB_URL}" class="text-accent hover:underline">memorize</a>'s cross-machine sync.
   AGPL-3.0.</p>
 </div>
</footer>
</body></html>`;
}

/** Escape user- or value-derived text for safe interpolation into HTML. */
export function htmlEscape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * The Hub's public origin for example commands: prefer the configured public URL,
 * else derive from the request Host (http for localhost, https otherwise).
 */
export function originFor(req: IncomingMessage, config: GatewayConfig): string {
  if (config.publicUrl) return config.publicUrl;
  const host = req.headers.host ?? 'localhost:8080';
  const scheme = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? 'http' : 'https';
  return `${scheme}://${host}`;
}

/**
 * A copy-to-clipboard command row: a monospace box + a copy button that reads the
 * sibling code's text. The one small script is emitted once via `copyScript()`.
 */
export function cmdBlock(cmd: string): string {
  return `<div class="flex items-center gap-2 my-2">
 <code class="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-default bg-canvas-inset px-3 py-2 text-sm font-mono">${htmlEscape(cmd)}</code>
 <button type="button" class="copy btn shrink-0">copy</button></div>`;
}

/** The single clipboard handler shared by every `cmdBlock` on a page. */
export function copyScript(): string {
  return `<script>
document.addEventListener('click',function(e){
 var b=e.target;
 if(b&&b.classList&&b.classList.contains('copy')){
  var c=b.previousElementSibling;
  if(c&&navigator.clipboard){navigator.clipboard.writeText(c.textContent).then(function(){
   var t=b.textContent;b.textContent='copied';setTimeout(function(){b.textContent=t},1200);});}
 }
});
</script>`;
}

/* --------------------------------------------------------------------- docs --- */

export interface DocsPageLink {
  slug: string;
  title: string;
  section: string;
}

/** The docs page tree grouped by section, for the docs sidebar. */
export function docsSidebar(pages: DocsPageLink[], activeSlug: string): string {
  const order: string[] = [];
  const bySection = new Map<string, DocsPageLink[]>();
  for (const p of pages) {
    if (!bySection.has(p.section)) {
      bySection.set(p.section, []);
      order.push(p.section);
    }
    bySection.get(p.section)!.push(p);
  }
  return order
    .map((section) => {
      const links = bySection
        .get(section)!
        .map((p) => {
          const href = p.slug === '' ? '/docs' : `/docs/${p.slug}`;
          const cls =
            p.slug === activeSlug
              ? 'bg-canvas-subtle font-semibold text-fg'
              : 'text-fg-muted hover:bg-canvas-subtle hover:text-fg hover:no-underline';
          return `<a href="${href}" class="block rounded-md px-3 py-1.5 text-sm ${cls}">${htmlEscape(p.title)}</a>`;
        })
        .join('');
      return `<div class="mb-4"><p class="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">${htmlEscape(section)}</p>${links}</div>`;
    })
    .join('');
}

/**
 * The docs shell — a dedicated documentation layout, deliberately WITHOUT the
 * account avatar/menu chrome. Header carries the section brand + an "Open
 * dashboard" button; a left page-tree sidebar sits beside the content.
 */
export function docsLayout({
  title,
  sidebar,
  content,
}: {
  title: string;
  sidebar: string;
  content: string;
}): string {
  return `${pageHead(title)}<body class="min-h-screen bg-canvas text-fg antialiased">
<header class="sticky top-0 z-30 border-b border-default bg-canvas/90 backdrop-blur">
 <div class="max-w-6xl mx-auto flex items-center justify-between gap-4 px-5 py-3">
  <a href="/" class="font-semibold text-fg hover:no-underline">memorize <span class="text-fg-muted">Hub</span>
   <span class="ml-1 text-fg-subtle">Docs</span></a>
  <nav class="flex items-center gap-4 text-sm">
   <a href="${GITHUB_URL}" class="text-fg-muted hover:text-fg hover:no-underline">GitHub</a>
   <a href="/app" class="btn btn-primary">Open dashboard -&gt;</a>
  </nav>
 </div>
</header>
<div class="max-w-6xl mx-auto grid gap-10 px-5 py-8 md:grid-cols-[15rem_minmax(0,1fr)]">
 <aside class="md:sticky md:top-20 md:self-start">${sidebar}</aside>
 <main class="min-w-0 pb-16">${content}</main>
</div>
</body></html>`;
}

/* ----------------------------------------------------------------- operator --- */

export interface OperatorNavItem {
  label: string;
  /** null href renders a disabled item (a section not yet built) with a "soon" tag. */
  href: string | null;
  active?: boolean;
}

/**
 * The operator (`/admin`) shell — a dedicated console chrome, deliberately WITHOUT
 * the public site's marketing header/footer or the account avatar menu. A dense
 * top bar (live dot + "Operator" + who + sign out) and a left section rail
 * (Overview / Accounts / Billing) frame a read-only monitoring surface. Sections
 * that aren't built yet render as disabled "soon" rail items rather than dead links.
 */
export function operatorLayout({
  title,
  login,
  nav,
  body,
}: {
  title: string;
  login: string;
  nav: OperatorNavItem[];
  body: string;
}): string {
  const rail = nav
    .map((n) => {
      if (!n.href) {
        return `<span class="flex items-center justify-between rounded-md px-3 py-1.5 text-sm text-fg-subtle">${htmlEscape(n.label)}<span class="rounded bg-canvas-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide">soon</span></span>`;
      }
      const cls = n.active
        ? 'bg-canvas-subtle font-semibold text-fg'
        : 'text-fg-muted hover:bg-canvas-subtle hover:text-fg hover:no-underline';
      return `<a href="${n.href}" class="block rounded-md px-3 py-1.5 text-sm ${cls}">${htmlEscape(n.label)}</a>`;
    })
    .join('');
  return `${pageHead(title)}<body class="min-h-screen bg-canvas text-fg antialiased">
<header class="sticky top-0 z-30 border-b border-default bg-canvas/90 backdrop-blur">
 <div class="max-w-6xl mx-auto flex items-center justify-between gap-4 px-5 py-3">
  <span class="flex items-center gap-2 font-semibold text-fg">
   <span class="inline-block h-2 w-2 rounded-full bg-success" title="live"></span>
   Operator <span class="ml-1 font-normal text-fg-subtle">memorize Hub</span>
  </span>
  <nav class="flex items-center gap-4 text-sm text-fg-muted">
   <span class="tabular-nums">@${htmlEscape(login)}</span>
   <a href="/account/logout" class="hover:text-fg hover:no-underline">Sign out</a>
  </nav>
 </div>
</header>
<div class="max-w-6xl mx-auto grid gap-10 px-5 py-8 md:grid-cols-[13rem_minmax(0,1fr)]">
 <aside class="md:sticky md:top-20 md:self-start"><nav class="space-y-0.5">${rail}</nav></aside>
 <main class="min-w-0 pb-16">${body}</main>
</div>
</body></html>`;
}

export { GITHUB_URL };
