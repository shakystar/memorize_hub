import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless signed cookies (account session + operator session + OAuth state). A
 * value is `<base64url(json)>.<base64url(hmac)>`; verification is constant-time
 * and checks an embedded expiry. No server-side session store — the HMAC secret
 * (GATEWAY_SESSION_SECRET) is the only trust anchor.
 */

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function signValue(value: object, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyValue<T = unknown>(token: string | undefined, secret: string): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(payload, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (typeof value.exp === 'number' && Date.now() > value.exp) return null;
    return value as T;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Account session — a user signed in via GitHub OAuth. Scoped to Path=/ (the web
 * surface spans /account, /join, and future pages). Carries the resolved
 * accountId (H040 `acc_…`) plus the login + verified email for display and for
 * attaching self-minted keys to the right account row.
 */
export interface AccountSession {
  accountId: string;
  login: string;
  email: string;
  exp: number;
}

const ACCOUNT_COOKIE = 'hub_acct';

export function accountCookie(
  identity: { accountId: string; login: string; email: string },
  secret: string,
): string {
  const session: AccountSession = {
    accountId: identity.accountId,
    login: identity.login,
    email: identity.email,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const value = signValue(session, secret);
  return `${ACCOUNT_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearAccountCookie(): string {
  return `${ACCOUNT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export function readAccount(
  cookieHeader: string | undefined,
  secret: string,
): AccountSession | null {
  const token = parseCookies(cookieHeader)[ACCOUNT_COOKIE];
  return verifyValue<AccountSession>(token, secret);
}
