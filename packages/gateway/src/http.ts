import type { IncomingMessage, ServerResponse } from 'node:http';

/** Small HTTP helpers shared by every handler. */

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

/** Uniform error body shape (docs/protocol/README.md §4): `{ "error": "..." }`. */
export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/**
 * Skeleton marker: a route that is wired but not yet ported/implemented returns
 * `501` with its label, so the surface is runnable and self-documenting during
 * the clean rebuild. Replace call sites as each handler lands.
 */
export function notImplemented(res: ServerResponse, label: string): void {
  sendError(res, 501, `not implemented (rebuild in progress): ${label}`);
}

/**
 * Internal skeleton marker for a DAL function whose body is not yet ported. Keeps
 * types honest (returns `never`) so the module still typechecks. Replace with a
 * real implementation; never ship a reachable call to this.
 */
export function todo(name: string): never {
  throw new Error(`not implemented (rebuild in progress): ${name}`);
}

export function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
