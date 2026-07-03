#!/usr/bin/env node
import { authorMemory, type AuthorMemoryKind } from './author.js';
import { readTasks } from './tasks.js';
import { readTimeline } from './timeline.js';

/**
 * `hub-replica` H060 entry points.
 *
 *   hub-replica author-memory --hub <url> --workspace <wsp_...>
 *     --kind decision|rationale|progress --text <text> --salience 1..10
 *
 *   hub-replica timeline --hub <url> --workspace <wsp_...> [--limit 50]
 *   hub-replica tasks --hub <url> --workspace <wsp_...>
 *
 * The caller's key comes from HUB_API_KEY (env), never argv, so secrets stay
 * out of shell history and process lists. MEMORIZE_ROOT (env) locates the
 * replica's server-side store root.
 */

const USAGE =
  'Usage: hub-replica author-memory --hub <url> --workspace <wsp_...> ' +
  '--kind <decision|rationale|progress> --text <text> --salience <1..10>\n' +
  '   or: hub-replica timeline --hub <url> --workspace <wsp_...> [--limit <n>]\n' +
  '   or: hub-replica tasks --hub <url> --workspace <wsp_...>\n' +
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
  const flags = parseArgs(rest);

  const hubUrl = flags.get('hub');
  const workspaceId = flags.get('workspace');
  const apiKey = process.env.HUB_API_KEY;
  if (!hubUrl || !workspaceId || !apiKey) throw new Error(USAGE);

  if (command === 'author-memory') {
    const kind = flags.get('kind');
    const text = flags.get('text');
    const salience = Number(flags.get('salience'));
    if (!kind || !text) throw new Error(USAGE);
    const result = await authorMemory({
      hubUrl,
      apiKey,
      workspaceId,
      item: { kind: kind as AuthorMemoryKind, text, salience },
    });
    console.log(JSON.stringify(result));
    return;
  }

  if (command === 'timeline') {
    const rawLimit = flags.get('limit');
    const result = await readTimeline({
      hubUrl,
      apiKey,
      workspaceId,
      ...(rawLimit ? { limit: Number(rawLimit) } : {}),
    });
    console.log(JSON.stringify(result));
    return;
  }

  if (command === 'tasks') {
    const result = await readTasks({ hubUrl, apiKey, workspaceId });
    console.log(JSON.stringify(result));
    return;
  }

  throw new Error(USAGE);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
