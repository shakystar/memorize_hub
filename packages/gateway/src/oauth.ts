import { randomBytes } from 'node:crypto';

import type { GatewayConfig } from './config.js';
import { signValue, verifyValue } from './session.js';

/** Minimal GitHub OAuth (authorization code) for operator dashboard login. */

const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const USER = 'https://api.github.com/user';
const STATE_COOKIE = 'hub_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

export function callbackUrl(config: GatewayConfig): string {
  return `${config.publicUrl}/admin/callback`;
}

/** Build the authorize redirect + a signed state cookie to set alongside it. */
export function beginLogin(config: GatewayConfig): { redirectTo: string; setCookie: string } {
  const nonce = randomBytes(16).toString('base64url');
  const state = signValue({ nonce, exp: Date.now() + STATE_TTL_MS }, config.sessionSecret!);
  const url = new URL(AUTHORIZE);
  url.searchParams.set('client_id', config.githubClientId!);
  url.searchParams.set('redirect_uri', callbackUrl(config));
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  return {
    redirectTo: url.toString(),
    setCookie: `${STATE_COOKIE}=${state}; Path=/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=${STATE_TTL_MS / 1000}`,
  };
}

/** Verify the returned state against the signed cookie (CSRF protection). */
export function checkState(
  returnedState: string | undefined,
  cookieState: string | undefined,
  secret: string,
): boolean {
  if (!returnedState || !cookieState || returnedState !== cookieState) return false;
  return verifyValue(returnedState, secret) !== null;
}

export const clearStateCookie = `${STATE_COOKIE}=; Path=/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;

/** Exchange an authorization code for the authenticated GitHub login name. */
export async function resolveLogin(config: GatewayConfig, code: string): Promise<string | null> {
  const tokenRes = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: callbackUrl(config),
    }),
  });
  if (!tokenRes.ok) return null;
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) return null;

  const userRes = await fetch(USER, {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'memorize-hub-gateway',
    },
  });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as { login?: string };
  return user.login ?? null;
}
