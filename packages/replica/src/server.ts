import { createServer, type Server, type ServerResponse } from 'node:http';

import { readTimeline } from './timeline.js';

export interface ReplicaServerOptions {
  relayUrl: string;
  relayToken?: string;
}

const TIMELINE_ROUTE = /^\/v1\/workspaces\/([^/]+)\/timeline$/;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createReplicaServer(options: ReplicaServerOptions): Server {
  return createServer((req, res) => {
    void (async () => {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://replica.local');

      if (method === 'GET' && url.pathname === '/healthz') {
        sendJson(res, 200, { ok: true });
        return;
      }

      const timeline = TIMELINE_ROUTE.exec(url.pathname);
      if (method === 'GET' && timeline) {
        const rawLimit = url.searchParams.get('limit');
        const result = await readTimeline({
          hubUrl: options.relayUrl,
          apiKey: options.relayToken ?? '',
          workspaceId: decodeURIComponent(timeline[1] ?? ''),
          ...(rawLimit ? { limit: Number(rawLimit) } : {}),
        });
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    })().catch((error: unknown) => {
      console.error('[replica] internal error:', error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal replica error' });
      } else {
        res.end();
      }
    });
  });
}
