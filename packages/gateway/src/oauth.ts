import { randomBytes } from 'node:crypto';

import type { GatewayConfig } from './config.js';
import { signValue, verifyValue } from './session.js';

/**
 * Minimal GitHub OAuth (authorization code), shared by two flows: the operator
 * dashboard (`/admin/*`) and participant self-service (`/account/*`). The flows
 * differ only in callback path, the state-cookie Path scope, and the requested
 * scope — everything else (state signing, code exchange) is identical.
 *
 * A single GitHub OAuth App backs both: register its Authorization callback URL
 * at the site root so both `/admin/callback` and `/account/callback` are valid
 * sub-paths.
 */

const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const USER = 'https://api.github.com/user';
const EMAILS = 'https://api.github.com/user/emails';
const STATE_COOKIE = 'hub_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

const DEFAULT_CALLBACK = '/admin/callback';
const DEFAULT_COOKIE_PATH = '/admin';
const DEFAULT_SCOPE = 'read:user';

export interface LoginOptions {
  /** Path GitHub redirects back to (must be a sub-path of the registered callback). */
  callbackPath?: string;
  /** Path the signed state cookie is scoped to (matches the callback's directory). */
  cookiePath?: string;
  /** OAuth scope; the participant flow adds `user:email` to read a verified email. */
  scope?: string;
}

export function callbackUrl(config: GatewayConfig, path: string = DEFAULT_CALLBACK): string {
  return `${config.publicUrl}${path}`;
}

/** Build the authorize redirect + a signed state cookie to set alongside it. */
export function beginLogin(
  config: GatewayConfig,
  opts: LoginOptions = {},
): { redirectTo: string; setCookie: string } {
  const callbackPath = opts.callbackPath ?? DEFAULT_CALLBACK;
  const cookiePath = opts.cookiePath ?? DEFAULT_COOKIE_PATH;
  const scope = opts.scope ?? DEFAULT_SCOPE;
  const nonce = randomBytes(16).toString('base64url');
  const state = signValue({ nonce, exp: Date.now() + STATE_TTL_MS }, config.sessionSecret!);
  const url = new URL(AUTHORIZE);
  url.searchParams.set('client_id', config.githubClientId!);
  url.searchParams.set('redirect_uri', callbackUrl(config, callbackPath));
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return {
    redirectTo: url.toString(),
    setCookie: `${STATE_COOKIE}=${state}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Secure; Max-Age=${STATE_TTL_MS / 1000}`,
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

/** Expire the OAuth state cookie for the given flow's path scope. */
export function clearStateCookie(cookiePath: string = DEFAULT_COOKIE_PATH): string {
  return `${STATE_COOKIE}=; Path=${cookiePath}; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export interface ResolvedLogin {
  login: string;
  /** Primary verified email — only populated when `fetchEmail` is requested. */
  email: string | null;
}

interface ResolveOptions {
  callbackPath?: string;
  /** Fetch the user's primary verified email (requires the `user:email` scope). */
  fetchEmail?: boolean;
}

/**
 * Exchange an authorization code for the authenticated GitHub login (and, for
 * the participant flow, a verified email). Returns null on any failure.
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
      redirect_uri: callbackUrl(config, opts.callbackPath ?? DEFAULT_CALLBACK),
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
