#!/usr/bin/env node
/**
 * hub-gateway-admin — operator CLI for the beta control plane (manual approval).
 *
 *   hub-gateway-admin requests list [pending|approved|denied]
 *   hub-gateway-admin requests approve <requestId> [--role member|viewer]
 *   hub-gateway-admin requests deny    <requestId>
 *   hub-gateway-admin tokens issue     <email> [--label <text>]
 *   hub-gateway-admin tokens revoke    <tokenId>
 *
 * Reads the same GATEWAY_DB the server uses. `approve` only grants access — the
 * participant mints their own key at /account. Use `tokens issue` to mint a key
 * for a participant who cannot sign in via GitHub; it prints the plaintext ONCE.
 */
import { loadGatewayConfig } from './config.js';
import { openGatewayDb } from './db.js';
import {
  approveAccessRequest,
  decideAccessRequest,
  getAccessRequest,
  issueKeyForEmail,
  listAccessRequests,
  revokeToken,
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
      if (!id) fail('usage: requests approve <requestId> [--role member|viewer]');
      const existing = getAccessRequest(db, id);
      if (!existing) fail(`no such request: ${id}`);
      if (existing.status !== 'pending') {
        console.warn(`note: request ${id} was already ${existing.status}; re-approving`);
      }
      const role = flag(rest, 'role') === 'viewer' ? 'viewer' : 'member';
      const result = approveAccessRequest(db, id, role);
      if (!result) fail(`no such request: ${id}`);
      const { request: req } = result;
      console.log(`approved ${id} — ${req.email} → ${req.requested_project_id} as ${result.role}`);
      console.log('access granted. the participant signs in at /account to mint their key.');
      console.log(`(non-OAuth fallback: hub-gateway-admin tokens issue ${req.email})`);
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

    if (group === 'tokens' && action === 'issue') {
      const email = rest[0];
      if (!email) fail('usage: tokens issue <email> [--label <text>]');
      const { plaintext, prefix } = issueKeyForEmail(db, email, flag(rest, 'label'));
      console.log(`issued key for ${email}`);
      console.log(`token prefix: ${prefix}`);
      console.log('');
      console.log('API KEY (shown once — give this to the participant):');
      console.log(`  ${plaintext}`);
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
        '  requests approve <requestId> [--role member|viewer]\n' +
        '  requests deny <requestId>\n' +
        '  tokens issue <email> [--label <text>]\n' +
        '  tokens revoke <tokenId>',
    );
  } finally {
    db.close();
  }
}

main();
