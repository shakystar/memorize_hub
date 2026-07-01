import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Workspace } from '@/lib/api';

/**
 * A searchable multi-select (Popover + Command) for scoping a key to workspaces —
 * the idiomatic shadcn pattern for picking several items from a list. Stays open
 * across selections; empty selection means an unscoped key.
 */
export function WorkspaceScopeSelect({
  workspaces,
  selected,
  onToggle,
}: {
  workspaces: Workspace[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    selected.size === 0
      ? 'All workspaces (unscoped)'
      : `${selected.size} workspace${selected.size > 1 ? 's' : ''} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-72 justify-between font-normal">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search workspaces…" />
          <CommandList>
            <CommandEmpty>No workspaces.</CommandEmpty>
            <CommandGroup>
              {workspaces.map((w) => {
                const on = selected.has(w.workspaceId);
                return (
                  <CommandItem
                    key={w.workspaceId}
                    value={`${w.name ?? ''} ${w.workspaceId}`}
                    onSelect={() => onToggle(w.workspaceId)}
                  >
                    <Check className={cn('mr-2 size-4', on ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">
                      {w.name ?? 'untitled'}{' '}
                      <span className="font-mono text-xs text-muted-foreground">{w.workspaceId}</span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
