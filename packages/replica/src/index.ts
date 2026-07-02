import { createReplicaServer } from './server.js';

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

const port = positiveInt(process.env.REPLICA_PORT, 8790, 'REPLICA_PORT');
const relayUrl = (process.env.REPLICA_RELAY_URL || process.env.RELAY_URL || 'http://127.0.0.1:8787')
  .replace(/\/+$/, '');

if (!process.env.MEMORIZE_ROOT) {
  throw new Error('MEMORIZE_ROOT must be set for the replica process');
}

const relayToken = process.env.RELAY_INTERNAL_TOKEN || process.env.MEMORIZE_RELAY_TOKEN;
const server = createReplicaServer({
  relayUrl,
  ...(relayToken ? { relayToken } : {}),
});

server.listen(port, '127.0.0.1', () => {
  console.log(`memorize_hub replica listening on :${port} -> relay ${relayUrl}`);
});
