import { randomBytes } from 'node:crypto';

import type { GatewayConfig } from './config.js';
import { signValue, verifyValue } from './session.js';

/**
 * Minimal Google OAuth (OpenID Connect authorization code) for account
 * self-service login. The operator dashboard reuses this SAME account session — an
 * allowlist check gates `/admin`, with no separate operator login or cookie. One
 * callback path, `/oauth/callback`, registered as the sole redirect URI on the
 * Google OAuth client. The (single) flow is carried in the signed `state` and
 * dispatched at the shared callback (see web.ts).
 */

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const STATE_COOKIE = 'hub_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

/** The one callback path both flows return to (register this exact URL on the app). */
export const CALLBACK_PATH = '/oauth/callback';
const COOKIE_PATH = '/oauth';
/** OIDC scopes: `openid email` for the verified email + stable `sub`, `profile` for display. */
const DEFAULT_SCOPE = 'openid email profile';

export type OAuthFlow = 'account';

export function callbackUrl(config: GatewayConfig): string {
  return `${config.publicUrl}${CALLBACK_PATH}`;
}

export interface LoginOptions {
  /** Which surface initiated login; dispatched at the shared callback. */
  flow: OAuthFlow;
  /** OIDC scope; defaults to `openid email profile` (verified email + stable sub). */
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
  url.searchParams.set('client_id', config.googleClientId!);
  url.searchParams.set('redirect_uri', callbackUrl(config));
  url.searchParams.set('response_type', 'code');
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
  if (!payload || payload.flow !== 'account') return null;
  return { flow: payload.flow };
}

export const clearStateCookie = `${STATE_COOKIE}=; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;

export const STATE_COOKIE_NAME = STATE_COOKIE;

export interface ResolvedLogin {
  /** Google's stable, immutable account id (OIDC `sub`) — the get-or-create key. */
  sub: string;
  /** Verified, lowercased primary email — the cross-channel anchor + display handle. */
  email: string;
}

/**
 * Exchange an authorization code for the Google identity: a stable `sub` and a
 * verified email. The token comes directly from Google over TLS and userinfo is
 * fetched from Google over TLS, so no local id_token signature check is needed.
 * Returns null on any failure or an unverified email.
 */
export async function resolveLogin(
  config: GatewayConfig,
  code: string,
): Promise<ResolvedLogin | null> {
  const tokenRes = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.googleClientId!,
      client_secret: config.googleClientSecret!,
      code,
      redirect_uri: callbackUrl(config),
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) return null;
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) return null;

  const userRes = await fetch(USERINFO, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
  });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
  };
  if (!user.sub || !user.email || user.email_verified !== true) return null;
  return { sub: user.sub, email: user.email.toLowerCase() };
}
