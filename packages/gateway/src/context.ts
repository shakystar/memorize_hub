import type Database from 'better-sqlite3';

import type { GatewayConfig } from './config.js';

/** Shared handler context: the control-plane DB + config. Carries no per-request state. */
export interface GatewayContext {
  db: Database.Database;
  config: GatewayConfig;
}
