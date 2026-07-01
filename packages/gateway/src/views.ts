import type { IncomingMessage } from 'node:http';

import type { GatewayConfig } from './config.js';

/**
 * Shared HTML shell for the Hub's server-rendered pages (landing, docs, account).
 * Styling is Tailwind v4 built to a static /assets/app.css, themed with GitHub
 * Primer design tokens (see the web-UI decision). Pages pass a pre-rendered,
 * trusted HTML body; this wraps it in the header/nav + footer chrome.
 */

const GITHUB_URL = 'https://github.com/shakystar/memorize';

export interface NavUser {
  /** GitHub login of the signed-in account, shown in the header. */
  login: string;
}

export interface LayoutOptions {
  title: string;
  /** Pre-rendered, trusted HTML for the page body. */
  body: string;
  /** The signed-in account, if any — swaps the header's Account link for a menu. */
  user?: NavUser | null;
  /** Widen the shell — used by the docs sidebar layout. */
  wide?: boolean;
}

/** Wrap a page body in the shared shell: sticky header nav + main + footer. */
export function layout({ title, body, user, wide = false }: LayoutOptions): string {
  const container = wide ? 'max-w-6xl' : 'max-w-3xl';
  const accountLink = user
    ? `<a href="/account" class="text-fg-muted hover:text-fg hover:no-underline">@${htmlEscape(user.login)}</a>`
    : `<a href="/account" class="text-fg-muted hover:text-fg hover:no-underline">Account</a>`;
  return `<!doctype html><html lang="en" class="bg-canvas text-fg"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
</head><body class="min-h-screen bg-canvas text-fg antialiased">
<header class="border-b border-default">
 <div class="${container} mx-auto flex items-center justify-between gap-4 px-5 py-3">
  <a href="/" class="font-semibold text-fg hover:no-underline">memorize <span class="text-fg-muted">Hub</span></a>
  <nav class="flex items-center gap-5 text-sm">
   <a href="/docs" class="text-fg-muted hover:text-fg hover:no-underline">Docs</a>
   ${accountLink}
   <a href="${GITHUB_URL}" class="text-fg-muted hover:text-fg hover:no-underline">GitHub</a>
  </nav>
 </div>
</header>
<main class="${container} mx-auto px-5 py-10">${body}</main>
<footer class="border-t border-default mt-16">
 <div class="${container} mx-auto px-5 py-8 text-sm text-fg-muted">
  <p>memorize Hub — the optional relay + control-plane for
   <a href="${GITHUB_URL}" class="text-accent hover:underline">memorize</a>'s cross-machine sync.
   AGPL-3.0. Shared-workspace memory is stored as plaintext on the operator's
   machine (operator-trusted; not end-to-end encrypted).</p>
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

export { GITHUB_URL };
