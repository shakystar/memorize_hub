#!/usr/bin/env node
/**
 * hub-gateway-admin — operator CLI for the beta control plane (manual approval).
 *
 *   hub-gateway-admin requests list [pending|approved|denied]
 *   hub-gateway-admin requests approve <requestId> [--label <text>]
 *   hub-gateway-admin requests deny    <requestId>
 *   hub-gateway-admin tokens revoke    <tokenId>
 *
 * Reads the same GATEWAY_DB the server uses. `approve` mints a project-scoped
 * API key and prints the plaintext ONCE — hand it to the participant.
 */
import { loadGatewayConfig } from './config.js';
import { openGatewayDb } from './db.js';
import {
  decideAccessRequest,
  getAccessRequest,
  grantProjectAccess,
  issueApiKey,
  listAccessRequests,
  revokeToken,
  upsertUser,
  type AccessRequest,
} from './store.js';

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function printRequest(r: AccessRequest): void {
  console.log(
    [r.id, r.status.padEnd(8), r.requested_project_id, r.email, r.note ?? ''].join('\t'),
  );
}

function main(): void {
  const [, , group, action, ...rest] = process.argv;
  const config = loadGatewayConfig();
  const db = openGatewayDb(config.dbFile);

  try {
    if (group === 'requests' && action === 'list') {
      const status = rest[0] as AccessRequest['status'] | undefined;
      const rows = listAccessRequests(db, status);
      if (rows.length === 0) {
        console.log('(no requests)');
        return;
      }
      rows.forEach(printRequest);
      return;
    }

    if (group === 'requests' && action === 'approve') {
      const id = rest[0];
      if (!id) fail('usage: requests approve <requestId> [--label <text>]');
      const req = getAccessRequest(db, id);
      if (!req) fail(`no such request: ${id}`);
      if (req.status !== 'pending') {
        console.warn(`note: request ${id} was already ${req.status}; re-approving`);
      }
      const userId = upsertUser(db, req.email);
      grantProjectAccess(db, userId, req.requested_project_id);
      const label = flag(rest, 'label') ?? req.email;
      const { plaintext, prefix } = issueApiKey(db, userId, label);
      decideAccessRequest(db, id, 'approved');
      console.log(`approved ${id} — ${req.email} → ${req.requested_project_id}`);
      console.log(`token prefix: ${prefix}`);
      console.log('');
      console.log('API KEY (shown once — give this to the participant):');
      console.log(`  ${plaintext}`);
      return;
    }

    if (group === 'requests' && action === 'deny') {
      const id = rest[0];
      if (!id) fail('usage: requests deny <requestId>');
      if (!getAccessRequest(db, id)) fail(`no such request: ${id}`);
      decideAccessRequest(db, id, 'denied');
      console.log(`denied ${id}`);
      return;
    }

    if (group === 'tokens' && action === 'revoke') {
      const id = rest[0];
      if (!id) fail('usage: tokens revoke <tokenId>');
      console.log(revokeToken(db, id) ? `revoked ${id}` : `no live token: ${id}`);
      return;
    }

    fail(
      'usage:\n' +
        '  requests list [pending|approved|denied]\n' +
        '  requests approve <requestId> [--label <text>]\n' +
        '  requests deny <requestId>\n' +
        '  tokens revoke <tokenId>',
    );
  } finally {
    db.close();
  }
}

main();
