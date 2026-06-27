import type { IncomingMessage } from 'node:http';

import type { GatewayConfig } from './config.js';

/** Shared HTML shell + helpers for the Hub's public pages (landing, beta, docs).
 * Zero-dependency, hand-written HTML - matches the gateway's std-lib style. */

const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;color:#1a1a1a;background:#fff}
@media(prefers-color-scheme:dark){body{color:#e8e8e8;background:#161616}}
a{color:#2563eb;text-decoration:none}
@media(prefers-color-scheme:dark){a{color:#6ea8fe}}
a:hover{text-decoration:underline}
header.site,main,footer.site{max-width:48rem;margin:0 auto;padding-left:1.25rem;padding-right:1.25rem}
body.wide header.site,body.wide main,body.wide footer.site{max-width:60rem}
header.site{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding-top:1.1rem;padding-bottom:1.1rem;border-bottom:1px solid #e5e5e5}
@media(prefers-color-scheme:dark){header.site{border-color:#2a2a2a}}
header.site .brand{font-weight:700;color:inherit;font-size:1.05rem}
header.site nav a{margin-left:1rem;font-size:.92rem}
main{padding-top:2rem;padding-bottom:3rem}
h1{font-size:1.7rem;line-height:1.2;margin:.2rem 0 .6rem}
h2{font-size:1.15rem;margin:2rem 0 .5rem}
p.lead{font-size:1.1rem;color:#444}
@media(prefers-color-scheme:dark){p.lead{color:#bbb}}
.muted{color:#666;font-size:.9rem}
@media(prefers-color-scheme:dark){.muted{color:#999}}
.btn{display:inline-block;margin:1.1rem 0;padding:.65rem 1.3rem;border-radius:8px;background:#1a1a1a;color:#fff;font-weight:600}
@media(prefers-color-scheme:dark){.btn{background:#e8e8e8;color:#161616}}
.btn:hover{text-decoration:none;opacity:.9}
code{background:#f3f3f3;padding:.12rem .35rem;border-radius:4px;font-size:.9em}
@media(prefers-color-scheme:dark){code{background:#262626}}
pre{background:#f6f6f6;padding:.9rem 1rem;border-radius:8px;overflow-x:auto;font-size:.86rem;line-height:1.5}
@media(prefers-color-scheme:dark){pre{background:#1e1e1e}}
pre code{background:none;padding:0}
ol.steps{padding-left:1.2rem}ol.steps li{margin:.4rem 0}
.docs-wrap{display:grid;grid-template-columns:13rem 1fr;gap:2.5rem;align-items:start}
.docs-side{position:sticky;top:1.5rem}
.docs-side .label{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:#888;margin:1.1rem 0 .4rem .5rem}
.docs-side .label:first-child{margin-top:0}
.docs-side ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.1rem}
.docs-side a{display:block;padding:.3rem .55rem;border-radius:6px;font-size:.95rem;color:inherit}
.docs-side a:hover{background:rgba(127,127,127,.12);text-decoration:none}
.docs-side a[aria-current="page"]{font-weight:700;background:rgba(127,127,127,.16)}
.docs-main{min-width:0}
.docs-main h1:first-child{margin-top:0}
@media(max-width:640px){
 .docs-wrap{grid-template-columns:1fr;gap:1rem}
 .docs-side{position:static;border-bottom:1px solid #e5e5e5;padding-bottom:.7rem}
 .docs-side ul{flex-direction:row;flex-wrap:wrap;gap:.2rem .6rem}
}
@media(prefers-color-scheme:dark){.docs-side{border-color:#2a2a2a}}
footer.site{padding-top:1.5rem;padding-bottom:2rem;margin-top:2rem;border-top:1px solid #e5e5e5;font-size:.85rem;color:#666}
@media(prefers-color-scheme:dark){footer.site{border-color:#2a2a2a;color:#999}}
label{display:block;margin:1rem 0 .25rem;font-weight:600}
input,textarea{width:100%;padding:.5rem;border:1px solid #bbb;border-radius:6px;font:inherit;background:inherit;color:inherit}
@media(prefers-color-scheme:dark){input,textarea{border-color:#3a3a3a}}
button.submit{margin-top:1.25rem;padding:.6rem 1.2rem;border:0;border-radius:6px;background:#1a1a1a;color:#fff;font:inherit;cursor:pointer}
@media(prefers-color-scheme:dark){button.submit{background:#e8e8e8;color:#161616}}
`.trim();

const GITHUB_URL = 'https://github.com/shakystar/memorize';

export interface LayoutOptions {
  title: string;
  /** Pre-rendered, trusted HTML for the page body. */
  body: string;
  /** Widen the shell - used by the docs sidebar layout. */
  wide?: boolean;
}

/** Wrap a page body in the shared shell: header nav + main + footer. */
export function layout({ title, body, wide = false }: LayoutOptions): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title)}</title>
<style>${STYLE}</style></head><body${wide ? ' class="wide"' : ''}>
<header class="site">
 <a class="brand" href="/">memorize Hub</a>
 <nav><a href="/docs">Docs</a><a href="/beta">Beta</a><a href="${GITHUB_URL}">GitHub</a></nav>
</header>
<main>${body}</main>
<footer class="site">
 <p>memorize Hub - the optional relay for <a href="${GITHUB_URL}">memorize</a>'s cross-machine sync.
 AGPL-3.0. Events are stored as plaintext on the operator's machine (operator-trusted; not end-to-end encrypted).</p>
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

/** The Hub's public origin for example commands: prefer the configured public
 * URL, else derive from the request Host (http for localhost, https otherwise). */
export function originFor(req: IncomingMessage, config: GatewayConfig): string {
  if (config.publicUrl) return config.publicUrl;
  const host = req.headers.host ?? 'localhost:8080';
  const scheme = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? 'http' : 'https';
  return `${scheme}://${host}`;
}

export { GITHUB_URL };
