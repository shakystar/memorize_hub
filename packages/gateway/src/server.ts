import { createServer, type Server } from 'node:http';

import type Database from 'better-sqlite3';

import { handleBetaPage, handleBetaSubmit } from './beta.js';
import type { GatewayConfig } from './config.js';
import { handleAdmin } from './dashboard.js';
import { handleDocs } from './docs.js';
import { handleLanding } from './landing.js';
import { handleEventsProxy, sendJson, type ProxyContext } from './proxy.js';

const EVENTS_ROUTE = /^\/v1\/projects\/([^/]+)\/events$/;

export interface GatewayServerOptions {
  db: Database.Database;
  config: GatewayConfig;
}

/**
 * The Hub's public edge. Authenticates participants and reverse-proxies the
 * relay; it never stores or interprets event payloads itself.
 */
export function createGatewayServer(options: GatewayServerOptions): Server {
  const ctx: ProxyContext = { db: options.db, config: options.config };

  return createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://gateway.local');

        // Gateway's own liveness — public, no auth (platform health checks).
        if (req.method === 'GET' && url.pathname === '/healthz') {
          sendJson(res, 200, { ok: true });
          return;
        }

        // Public landing page.
        if (req.method === 'GET' && url.pathname === '/') {
          handleLanding(req, res, ctx);
          return;
        }

        // Public docs surface.
        if (req.method === 'GET' && (url.pathname === '/docs' || url.pathname.startsWith('/docs/'))) {
          handleDocs(req, res, ctx, url);
          return;
        }

        // Public beta access-request surface (no auth; manual approval).
        if (req.method === 'GET' && url.pathname === '/beta') {
          handleBetaPage(res);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/beta/requests') {
          await handleBetaSubmit(req, res, ctx);
          return;
        }

        // Operator dashboard (GitHub-OAuth-gated; 503 if not configured).
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
          await handleAdmin(req, res, url, ctx);
          return;
        }

        const eventsMatch = EVENTS_ROUTE.exec(url.pathname);
        if (eventsMatch && (req.method === 'GET' || req.method === 'POST')) {
          const projectId = decodeURIComponent(eventsMatch[1]!);
          await handleEventsProxy(req, res, projectId, ctx);
          return;
        }

        sendJson(res, 404, { error: 'not found' });
      } catch (error) {
        console.error('gateway error:', error);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
        else res.end();
      }
    })();
  });
}
