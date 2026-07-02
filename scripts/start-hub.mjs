#!/usr/bin/env node
/**
 * Single-machine launcher: run relay, replica, and gateway as separate
 * processes in one container. Relay and replica bind to 127.0.0.1; gateway is
 * public. They talk over HTTP + the internal token, so gateway never imports
 * relay storage or projection logic while the deployment stays one VM.
 *
 * One secret feeds both sides of the internal token: if RELAY_INTERNAL_TOKEN is
 * set and MEMORIZE_RELAY_TOKEN is not, mirror it so the relay gates on the same
 * value the gateway and replica present.
 */
import { spawn } from 'node:child_process';

const env = { ...process.env };
if (env.RELAY_INTERNAL_TOKEN && !env.MEMORIZE_RELAY_TOKEN) {
  env.MEMORIZE_RELAY_TOKEN = env.RELAY_INTERNAL_TOKEN;
}
if (!env.REPLICA_PORT) env.REPLICA_PORT = '8790';
if (!env.REPLICA_URL) env.REPLICA_URL = `http://127.0.0.1:${env.REPLICA_PORT}`;
if (!env.REPLICA_RELAY_URL) env.REPLICA_RELAY_URL = env.RELAY_URL || 'http://127.0.0.1:8787';
if (!env.MEMORIZE_ROOT) env.MEMORIZE_ROOT = '/data/replica';

const services = [
  ['relay', 'packages/relay/dist/index.js'],
  ['replica', 'packages/replica/dist/index.js'],
  ['gateway', 'packages/gateway/dist/index.js'],
];

const children = services.map(([name, entry]) => {
  const child = spawn(process.execPath, [entry], { stdio: 'inherit', env });
  child.on('exit', (code, signal) => {
    console.error(`[start-hub] ${name} exited (code=${code}, signal=${signal}); shutting down`);
    for (const other of children) {
      if (other !== child) other.kill('SIGTERM');
    }
    process.exit(code ?? 1);
  });
  return child;
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
