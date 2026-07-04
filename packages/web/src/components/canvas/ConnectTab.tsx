import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Connect — the workspace's always-there onboarding surface, in GitHub
 * quick-setup grammar: the share URL bar, then one command block
 * (`login` + `connect`, which auto-branches between a fresh machine and an
 * existing local project). No `npm i -g` line — install and env wiring go
 * through the AI_SETUP guide. Same copy as the /clone/:id landing.
 */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

/** A titled multi-line command block with one whole-block copy button. */
function CommandBlock({ title, cmds }: { title: string; cmds: string[] }) {
  return (
    <section className="mt-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <CopyButton text={cmds.join('\n')} />
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-card px-3 py-2 text-xs font-mono leading-6">
        {cmds.join('\n')}
      </pre>
    </section>
  );
}

const SETUP_GUIDE_URL =
  'https://github.com/shakystar/memorize/blob/main/guides/AI_SETUP.md';

export function ConnectTab({ workspaceId }: { workspaceId: string }) {
  const origin = window.location.origin;
  const cloneUrl = `${origin}/clone/${workspaceId}`;
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Quick setup — if you&apos;ve done this before</h2>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-card px-3 py-1.5 text-xs font-mono">
            {cloneUrl}
          </code>
          <CopyButton text={cloneUrl} />
        </div>
      </section>

      <CommandBlock
        title="Set up on a new machine or project"
        cmds={[`memorize login ${origin}`, `memorize connect ${cloneUrl}`]}
      />

      <section className="mt-4 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">…or hand setup to your AI agent</h2>
          <CopyButton
            text={`Follow this guide to set up memorize in this project: ${SETUP_GUIDE_URL}`}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Paste this to your coding agent — it installs and wires memorize for you:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-card px-3 py-2 text-xs font-mono leading-6">
          {`Follow this guide to set up memorize in this project:\n${SETUP_GUIDE_URL}`}
        </pre>
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        After connecting, sync runs automatically at session boundaries.
      </p>
    </div>
  );
}
