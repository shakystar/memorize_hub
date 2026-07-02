#!/usr/bin/env node
import { authorMemory, type AuthorMemoryKind } from './author.js';

/**
 * `hub-replica` H060 S1 on-demand entry (deployment form A): one invocation
 * = author one memory as the calling user + push + exit.
 *
 *   hub-replica author-memory --hub <url> --workspace <wsp_…> \
 *     --kind decision|rationale|progress --text "…" --salience 1..10
 *
 * The caller's key comes from HUB_API_KEY (env), never argv, so secrets stay
 * out of shell history and process lists. MEMORIZE_ROOT (env) locates the
 * replica's server-side store root.
 */

const USAGE =
  'Usage: hub-replica author-memory --hub <url> --workspace <wsp_...> ' +
  '--kind <decision|rationale|progress> --text <text> --salience <1..10> ' +
  '(key via HUB_API_KEY env; store root via MEMORIZE_ROOT env)';

function parseArgs(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(USAGE);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(USAGE);
    flags.set(arg.slice(2), value);
    i += 1;
  }
  return flags;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'author-memory') throw new Error(USAGE);
  const flags = parseArgs(rest);

  const hubUrl = flags.get('hub');
  const workspaceId = flags.get('workspace');
  const kind = flags.get('kind');
  const text = flags.get('text');
  const salience = Number(flags.get('salience'));
  const apiKey = process.env.HUB_API_KEY;
  if (!hubUrl || !workspaceId || !kind || !text || !apiKey) throw new Error(USAGE);

  const result = await authorMemory({
    hubUrl,
    apiKey,
    workspaceId,
    item: { kind: kind as AuthorMemoryKind, text, salience },
  });
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
