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
  /** Public base URL, used only for copy on the access-request page. */
  publicUrl: string | undefined;
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
    publicUrl: env.GATEWAY_PUBLIC_URL || undefined,
  };
}
