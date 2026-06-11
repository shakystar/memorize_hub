/** Env-driven configuration (AGENTS.md "Configuration"). */
import { DEFAULT_MAX_BODY_BYTES } from './server.js';

export interface RelayConfig {
  port: number;
  storeDir: string;
  token: string | undefined;
  maxBodyBytes: number;
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    port: positiveInt(env.MEMORIZE_RELAY_PORT, 8787, 'MEMORIZE_RELAY_PORT'),
    storeDir: env.MEMORIZE_RELAY_STORE || './data',
    token: env.MEMORIZE_RELAY_TOKEN || undefined,
    maxBodyBytes: positiveInt(
      env.MEMORIZE_RELAY_MAX_BODY,
      DEFAULT_MAX_BODY_BYTES,
      'MEMORIZE_RELAY_MAX_BODY',
    ),
  };
}
