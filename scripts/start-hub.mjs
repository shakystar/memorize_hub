#!/usr/bin/env node
/**
 * Single-machine launcher: run the relay and the gateway as TWO separate
 * processes in one container (relay on 127.0.0.1, gateway public). They still
 * talk only over HTTP+token — the gateway never imports the relay's store —
 * so this honors the separate-process boundary while halving VM cost.
 *
 * One secret feeds both sides of the internal token: if RELAY_INTERNAL_TOKEN is
 * set and MEMORIZE_RELAY_TOKEN is not, mirror it so the relay gates on the same
 * value the gateway presents.
 */
import { spawn } from 'node:child_process';

const env = { ...process.env };
if (env.RELAY_INTERNAL_TOKEN && !env.MEMORIZE_RELAY_TOKEN) {
  env.MEMORIZE_RELAY_TOKEN = env.RELAY_INTERNAL_TOKEN;
}

const services = [
  ['relay', 'packages/relay/dist/index.js'],
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
