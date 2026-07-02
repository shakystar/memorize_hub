import { Check, Copy, Terminal } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** One copy-pasteable command: a monospace row + a copy button with ✓ feedback. */
function CommandRow({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-card px-3 py-1.5 text-xs font-mono">
        {cmd}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        title="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(cmd).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/**
 * "Connect" — the per-workspace onboarding block, anchored next to Share. Both
 * branches render in full (copy-paste completeness beats DRY): join from a new
 * machine (clone) or attach an existing local project (remote). No sync line —
 * clone/remote do the first pull/push themselves, then sync runs automatically
 * at session boundaries. Mirrors the /clone/:id landing this URL renders.
 */
export function ConnectPopover({ workspaceId }: { workspaceId: string }) {
  const origin = window.location.origin;
  const cloneUrl = `${origin}/clone/${workspaceId}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          <Terminal /> Connect
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] p-3">
        <p className="text-xs font-medium text-muted-foreground">Join from a new machine</p>
        <CommandRow cmd="npm i -g @shakystar/memorize" />
        <CommandRow cmd={`memorize login ${origin}`} />
        <CommandRow cmd={`memorize clone ${cloneUrl}`} />
        <p className="mt-3 text-xs font-medium text-muted-foreground">
          Already have the project locally?
        </p>
        <CommandRow cmd="npm i -g @shakystar/memorize" />
        <CommandRow cmd={`memorize login ${origin}`} />
        <CommandRow cmd={`memorize remote ${cloneUrl}`} />
        <p className="mt-3 text-xs text-muted-foreground">
          After connecting, sync runs automatically at session boundaries.
        </p>
      </PopoverContent>
    </Popover>
  );
}
