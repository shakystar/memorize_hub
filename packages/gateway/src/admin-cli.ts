#!/usr/bin/env node
/**
 * Operator CLI (`hub-gateway-admin`). In the open-onboarding model (H080) there
 * is no manual approval queue; the operator surface shrinks to break-glass ops
 * (inspect accounts/stores, mint a key for a non-OAuth account, force-revoke).
 *
 * @remarks Skeleton — commands are ported with the account/keys/stores DAL. For
 * now it prints usage and exits non-zero so scripts don't assume success.
 */

function main(argv: string[]): number {
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log('hub-gateway-admin — operator CLI (clean rebuild in progress)');
    console.log('  commands are being ported; see docs/protocol/ + docs/SoT/H080.');
    return cmd ? 0 : 1;
  }
  console.error(`not implemented (rebuild in progress): ${cmd}`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
