import type { IncomingMessage, ServerResponse } from 'node:http';

import { adminEnabled, participantLoginEnabled } from './config.js';
import {
  clearStateCookie,
  resolveLogin,
  STATE_COOKIE_NAME,
  verifyCallback,
} from './oauth.js';
import type { ProxyContext } from './proxy.js';
import { operatorCookie, parseCookies, participantCookie } from './session.js';
import { upsertUserByGithub } from './store.js';
import { layout } from './views.js';

/**
 * The single shared OAuth return point (`GET /oauth/callback`). Verifies the
 * signed state (CSRF + flow), exchanges the code, then dispatches: operator
 * logins gate on the allowlist; participant logins upsert a user and set the
 * self-service session. One callback path keeps the GitHub App registration to
 * a single exact URL.
 */

function fail(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'set-cookie': clearStateCookie,
  });
  res.end(layout({ title: 'memorize Hub', body }));
}

function redirect(res: ServerResponse, location: string, setCookie: string[]): void {
  res.writeHead(302, { location, 'set-cookie': setCookie });
  res.end();
}

export async function handleOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ProxyContext,
): Promise<void> {
  const { config, db } = ctx;
  if (!config.sessionSecret) {
    fail(res, 503, '<h1>Login not configured</h1>');
    return;
  }
  const secret = config.sessionSecret;

  const cookieState = parseCookies(req.headers.cookie)[STATE_COOKIE_NAME];
  const state = verifyCallback(url.searchParams.get('state') ?? undefined, cookieState, secret);
  if (!state) {
    fail(res, 403, '<h1>Login failed</h1><p>Invalid state. <a href="/account">Try again</a>.</p>');
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    fail(res, 400, '<h1>Login failed</h1><p class="muted">Missing authorization code.</p>');
    return;
  }

  if (state.flow === 'admin') {
    if (!adminEnabled(config)) {
      fail(res, 503, '<h1>Operator dashboard not configured</h1>');
      return;
    }
    const resolved = await resolveLogin(config, code);
    if (!resolved || !config.adminLogins.includes(resolved.login)) {
      fail(res, 403, '<h1>Not authorized</h1><p class="muted">This GitHub account is not an operator.</p>');
      return;
    }
    redirect(res, '/admin', [operatorCookie(resolved.login, secret), clearStateCookie]);
    return;
  }

  // participant
  if (!participantLoginEnabled(config)) {
    fail(res, 503, '<h1>Accounts not configured</h1>');
    return;
  }
  const resolved = await resolveLogin(config, code, { fetchEmail: true });
  if (!resolved || !resolved.email) {
    fail(res, 403, '<h1>Login failed</h1><p class="muted">Could not read a verified email from your GitHub account.</p>');
    return;
  }
  const userId = upsertUserByGithub(db, resolved.login, resolved.email);
  redirect(res, '/account', [
    participantCookie({ userId, login: resolved.login, email: resolved.email }, secret),
    clearStateCookie,
  ]);
}
