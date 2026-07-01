import { randomBytes } from 'node:crypto';

import type { GatewayConfig } from './config.js';
import { signValue, verifyValue } from './session.js';

/**
 * Minimal GitHub OAuth (authorization code), shared by two flows: account
 * self-service login and the operator dashboard. Both use ONE callback path,
 * `/oauth/callback`, so a single GitHub OAuth App registers exactly that URL — no
 * reliance on GitHub's sub-directory redirect_uri matching. The flow is carried
 * in the signed `state` and dispatched at the shared callback (see web.ts).
 */

const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const USER = 'https://api.github.com/user';
const EMAILS = 'https://api.github.com/user/emails';
const STATE_COOKIE = 'hub_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

/** The one callback path both flows return to (register this exact URL on the app). */
export const CALLBACK_PATH = '/oauth/callback';
const COOKIE_PATH = '/oauth';
const DEFAULT_SCOPE = 'read:user';

export type OAuthFlow = 'admin' | 'account';

export function callbackUrl(config: GatewayConfig): string {
  return `${config.publicUrl}${CALLBACK_PATH}`;
}

export interface LoginOptions {
  /** Which surface initiated login; dispatched at the shared callback. */
  flow: OAuthFlow;
  /** OAuth scope; the account flow adds `user:email` to read a verified email. */
  scope?: string;
}

/** Build the authorize redirect + a signed state cookie (carrying the flow). */
export function beginLogin(
  config: GatewayConfig,
  opts: LoginOptions,
): { redirectTo: string; setCookie: string } {
  const scope = opts.scope ?? DEFAULT_SCOPE;
  const nonce = randomBytes(16).toString('base64url');
  const state = signValue(
    { nonce, flow: opts.flow, exp: Date.now() + STATE_TTL_MS },
    config.sessionSecret!,
  );
  const url = new URL(AUTHORIZE);
  url.searchParams.set('client_id', config.githubClientId!);
  url.searchParams.set('redirect_uri', callbackUrl(config));
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return {
    redirectTo: url.toString(),
    setCookie: `${STATE_COOKIE}=${state}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Secure; Max-Age=${STATE_TTL_MS / 1000}`,
  };
}

export interface CallbackState {
  flow: OAuthFlow;
}

/**
 * Verify the returned state against the signed cookie (CSRF guard) and recover the
 * flow. Returns null on any mismatch, bad signature, expiry, or unknown flow.
 */
export function verifyCallback(
  returnedState: string | undefined,
  cookieState: string | undefined,
  secret: string,
): CallbackState | null {
  if (!returnedState || !cookieState || returnedState !== cookieState) return null;
  const payload = verifyValue<{ flow?: OAuthFlow }>(returnedState, secret);
  if (!payload || (payload.flow !== 'admin' && payload.flow !== 'account')) return null;
  return { flow: payload.flow };
}

export const clearStateCookie = `${STATE_COOKIE}=; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;

export const STATE_COOKIE_NAME = STATE_COOKIE;

export interface ResolvedLogin {
  login: string;
  /** Primary verified email — only populated when `fetchEmail` is requested. */
  email: string | null;
}

interface ResolveOptions {
  /** Fetch the user's primary verified email (requires the `user:email` scope). */
  fetchEmail?: boolean;
}

/**
 * Exchange an authorization code for the authenticated GitHub login (and, for the
 * account flow, a verified email). Returns null on any failure.
 */
export async function resolveLogin(
  config: GatewayConfig,
  code: string,
  opts: ResolveOptions = {},
): Promise<ResolvedLogin | null> {
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
  const authHeaders = {
    authorization: `Bearer ${token.access_token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'memorize-hub-gateway',
  };

  const userRes = await fetch(USER, { headers: authHeaders });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as { login?: string };
  if (!user.login) return null;

  let email: string | null = null;
  if (opts.fetchEmail) {
    email = await primaryVerifiedEmail(authHeaders, user.login);
  }
  return { login: user.login, email };
}

/** Pick the primary verified email; fall back to GitHub's noreply form. */
async function primaryVerifiedEmail(
  authHeaders: Record<string, string>,
  login: string,
): Promise<string> {
  const fallback = `${login}@users.noreply.github.com`;
  try {
    const res = await fetch(EMAILS, { headers: authHeaders });
    if (!res.ok) return fallback;
    const emails = (await res.json()) as Array<{
      email?: string;
      primary?: boolean;
      verified?: boolean;
    }>;
    const primary = emails.find((e) => e.primary && e.verified && e.email);
    return primary?.email ?? fallback;
  } catch {
    return fallback;
  }
}
