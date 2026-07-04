import { createServer, type Server, type ServerResponse } from 'node:http';

import { readTasks } from './tasks.js';
import { decodeCursor, readTimeline, type TimelineCursor } from './timeline.js';

export interface ReplicaServerOptions {
  relayUrl: string;
  relayToken?: string;
}

const TIMELINE_ROUTE = /^\/v1\/workspaces\/([^/]+)\/timeline$/;
const TASKS_ROUTE = /^\/v1\/workspaces\/([^/]+)\/tasks$/;

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
        const limit = rawLimit === null ? undefined : Number(rawLimit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
          sendJson(res, 400, { error: 'limit must be a positive integer' });
          return;
        }
        const rawBefore = url.searchParams.get('before');
        let before: TimelineCursor | undefined;
        if (rawBefore !== null) {
          try {
            before = decodeCursor(rawBefore);
          } catch {
            sendJson(res, 400, { error: 'before must be a valid cursor' });
            return;
          }
        }
        const result = await readTimeline({
          hubUrl: options.relayUrl,
          apiKey: options.relayToken ?? '',
          workspaceId: decodeURIComponent(timeline[1] ?? ''),
          ...(limit !== undefined ? { limit } : {}),
          ...(before ? { before } : {}),
        });
        sendJson(res, 200, result);
        return;
      }

      const tasks = TASKS_ROUTE.exec(url.pathname);
      if (method === 'GET' && tasks) {
        const result = await readTasks({
          hubUrl: options.relayUrl,
          apiKey: options.relayToken ?? '',
          workspaceId: decodeURIComponent(tasks[1] ?? ''),
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
