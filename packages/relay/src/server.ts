/**
 * The relay's HTTP surface (PROTOCOL.md v1) on bare `node:http`:
 *
 *   POST /v1/projects/:id/events   SyncPushRequest  -> SyncPushResponse
 *   GET  /v1/projects/:id/events?since={id}         -> SyncPullResponse
 *   GET  /v1/stats                                  -> RelayStats  (internal ops)
 *   GET  /healthz                                   -> { ok: true }
 *
 * Optional bearer token gates every route (healthz included, so a token
 * holder verifies reachability and credentials in one call). `/v1/stats` is an
 * INTERNAL endpoint for the gateway's cost dashboard — sizes/counts only, never
 * payloads (relay opacity, H010); it is not part of the client wire contract.
 */
import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import {
  PROJECT_ID_PATTERN,
  type OpaqueEvent,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from './protocol.js';
import type { EventStore } from './store.js';

export interface RelayOptions {
  store: EventStore;
  /** When set, every route requires `Authorization: Bearer <token>`. */
  token?: string;
  /** Request body cap in bytes; over -> 413. Default 10 MiB. */
  maxBodyBytes?: number;
}

export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

const PROJECT_EVENTS = /^\/v1\/projects\/([^/]+)\/events$/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function authorized(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? '');
  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  );
}

async function readBody(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > maxBytes) {
      throw new HttpError(413, 'request body too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parsePushRequest(body: string): { events: OpaqueEvent[] } {
  let request: SyncPushRequest;
  try {
    request = JSON.parse(body) as SyncPushRequest;
  } catch {
    throw new HttpError(400, 'malformed JSON body');
  }
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new HttpError(400, 'body must be a JSON object');
  }
  const events = request.events ?? [];
  if (!Array.isArray(events)) {
    throw new HttpError(400, '`events` must be an array');
  }
  for (const event of events) {
    if (
      event === null ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      typeof event.id !== 'string'
    ) {
      throw new HttpError(400, 'every event must be an object with a string `id`');
    }
  }
  return { events };
}

export function createRelayServer(options: RelayOptions): Server {
  const { store, token } = options;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      try {
        if (token !== undefined && !authorized(req.headers.authorization, token)) {
          throw new HttpError(401, 'unauthorized');
        }

        const url = new URL(req.url ?? '/', 'http://relay.local');

        if (req.method === 'GET' && url.pathname === '/healthz') {
          send(200, { ok: true });
          return;
        }

        if (req.method === 'GET' && url.pathname === '/v1/stats') {
          send(200, await store.stats());
          return;
        }

        const match = PROJECT_EVENTS.exec(url.pathname);
        if (!match) {
          throw new HttpError(404, 'not found');
        }
        const projectId = decodeURIComponent(match[1]!);
        if (!PROJECT_ID_PATTERN.test(projectId)) {
          throw new HttpError(400, 'invalid project id');
        }

        if (req.method === 'POST') {
          const { events } = parsePushRequest(await readBody(req, maxBodyBytes));
          const accepted = await store.append(projectId, events);
          const lastAcceptedEventId = accepted[accepted.length - 1];
          const response: SyncPushResponse = {
            accepted,
            rejected: [],
            ...(lastAcceptedEventId !== undefined ? { lastAcceptedEventId } : {}),
          };
          send(200, response);
          return;
        }

        if (req.method === 'GET') {
          const since = url.searchParams.get('since') ?? undefined;
          const events = await store.read(projectId, since);
          const lastRemoteEventId = events[events.length - 1]?.id;
          const response: SyncPullResponse = {
            events,
            ...(lastRemoteEventId !== undefined ? { lastRemoteEventId } : {}),
          };
          send(200, response);
          return;
        }

        throw new HttpError(404, 'not found');
      } catch (error: unknown) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (error instanceof HttpError) {
          send(error.status, { error: error.message });
          return;
        }
        console.error('[relay] internal error:', error);
        send(500, { error: 'internal relay error' });
      }
    })();
  });
}
