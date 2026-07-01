import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless signed cookies (operator session + OAuth state). A value is
 * `<base64url(json)>.<base64url(hmac)>`; verification is constant-time and
 * checks an embedded expiry. No server-side session store — the HMAC secret
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

export interface OperatorSession {
  login: string;
  exp: number;
}

const SESSION_COOKIE = 'hub_op';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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

export function operatorCookie(login: string, secret: string): string {
  const session: OperatorSession = { login, exp: Date.now() + SESSION_TTL_MS };
  const value = signValue(session, secret);
  return `${SESSION_COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearOperatorCookie(): string {
  return `${SESSION_COOKIE}=; Path=/admin; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export function readOperator(
  cookieHeader: string | undefined,
  secret: string,
): OperatorSession | null {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  return verifyValue<OperatorSession>(token, secret);
}

/**
 * Participant session — a self-service (non-operator) user logged in via GitHub.
 * Scoped to Path=/ (the dashboard lives at /account but links elsewhere), and
 * carries the verified email so requests/keys attach to the right user row.
 */
export interface ParticipantSession {
  userId: string;
  login: string;
  email: string;
  exp: number;
}

const PARTICIPANT_COOKIE = 'hub_user';

export function participantCookie(
  identity: { userId: string; login: string; email: string },
  secret: string,
): string {
  const session: ParticipantSession = {
    userId: identity.userId,
    login: identity.login,
    email: identity.email,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const value = signValue(session, secret);
  return `${PARTICIPANT_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearParticipantCookie(): string {
  return `${PARTICIPANT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export function readParticipant(
  cookieHeader: string | undefined,
  secret: string,
): ParticipantSession | null {
  const token = parseCookies(cookieHeader)[PARTICIPANT_COOKIE];
  return verifyValue<ParticipantSession>(token, secret);
}
