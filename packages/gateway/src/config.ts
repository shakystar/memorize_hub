/** Env-driven configuration for the Hub control-plane gateway. */

export interface GatewayConfig {
  /** Public listen port (the gateway is the only public-facing surface). */
  port: number;
  /** Path to the control-plane sqlite DB (users/tokens/ACL/requests). */
  dbFile: string;
  /** Internal relay base URL — reached over localhost / a private network. */
  relayUrl: string;
  /** Bearer token the gateway presents to the (token-gated) relay. */
  relayToken: string | undefined;
  /** Public base URL — used for copy on the request page and the OAuth callback. */
  publicUrl: string | undefined;
  /** GitHub OAuth app client id (operator dashboard login). */
  githubClientId: string | undefined;
  /** GitHub OAuth app client secret. */
  githubClientSecret: string | undefined;
  /** GitHub logins allowed to operate the dashboard. */
  adminLogins: string[];
  /** HMAC secret for signing operator session + OAuth state cookies. */
  sessionSecret: string | undefined;
}

/** The operator dashboard is enabled only when OAuth is fully configured. */
export function adminEnabled(config: GatewayConfig): boolean {
  return participantLoginEnabled(config) && config.adminLogins.length > 0;
}

/**
 * Participant self-service login (/account) needs the same OAuth + session
 * config as the operator dashboard, minus the operator allowlist — anyone with
 * a GitHub account may sign in and request access.
 */
export function participantLoginEnabled(config: GatewayConfig): boolean {
  return Boolean(
    config.githubClientId &&
      config.githubClientSecret &&
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
    relayToken: env.RELAY_INTERNAL_TOKEN || undefined,
    publicUrl: env.GATEWAY_PUBLIC_URL ? env.GATEWAY_PUBLIC_URL.replace(/\/+$/, '') : undefined,
    githubClientId: env.GITHUB_CLIENT_ID || undefined,
    githubClientSecret: env.GITHUB_CLIENT_SECRET || undefined,
    adminLogins: (env.GATEWAY_ADMIN_LOGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sessionSecret: env.GATEWAY_SESSION_SECRET || undefined,
  };
}
