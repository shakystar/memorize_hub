/** Env-driven configuration for the Hub control-plane gateway. */

export interface GatewayConfig {
  /** Public listen port (the gateway is the only public-facing surface). */
  port: number;
  /** Path to the control-plane sqlite DB (accounts/keys/stores/memberships/invites). */
  dbFile: string;
  /** Internal relay base URL — reached over localhost / a private network. */
  relayUrl: string;
  /** Internal headless replica base URL for read projections. */
  replicaUrl: string;
  /** Bearer token the gateway presents to the (token-gated) relay. */
  relayToken: string | undefined;
  /** Public base URL — used for join/invite URLs and the OAuth callback. */
  publicUrl: string | undefined;
  /** Google OAuth client id (browser session login: /account, /join, /admin). */
  googleClientId: string | undefined;
  /** Google OAuth client secret. */
  googleClientSecret: string | undefined;
  /** Verified emails allowed to operate the /admin dashboard (lowercased). */
  adminEmails: string[];
  /** HMAC secret for signing session + OAuth state cookies. */
  sessionSecret: string | undefined;
}

/** The operator dashboard is enabled only when OAuth is fully configured. */
export function adminEnabled(config: GatewayConfig): boolean {
  return sessionLoginEnabled(config) && config.adminEmails.length > 0;
}

/**
 * Browser session login (/account, /join) needs OAuth + session config. With no
 * beta gate (Hub SoT H080), any Google account may sign in — the allowlist only
 * gates the operator /admin surface, not participation.
 */
export function sessionLoginEnabled(config: GatewayConfig): boolean {
  return Boolean(
    config.googleClientId &&
      config.googleClientSecret &&
      config.publicUrl &&
      config.sessionSecret,
  );
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    port: positiveInt(env.GATEWAY_PORT, 8080, 'GATEWAY_PORT'),
    dbFile: env.GATEWAY_DB || './gateway.db',
    relayUrl: (env.RELAY_URL || 'http://127.0.0.1:8787').replace(/\/+$/, ''),
    replicaUrl: (env.REPLICA_URL || 'http://127.0.0.1:8790').replace(/\/+$/, ''),
    relayToken: env.RELAY_INTERNAL_TOKEN || undefined,
    publicUrl: env.GATEWAY_PUBLIC_URL ? env.GATEWAY_PUBLIC_URL.replace(/\/+$/, '') : undefined,
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
    adminEmails: (env.GATEWAY_ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    sessionSecret: env.GATEWAY_SESSION_SECRET || undefined,
  };
}
