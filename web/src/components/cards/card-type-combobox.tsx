'use client';
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CurationBadge } from './curation-badge';

export interface CardTypeOption {
  id: string;
  displayName: string;
  variantId: string | null;
  active: boolean;
  curationStatus: string;
}

const MAX_SHOWN = 200;

/** WAI-ARIA combobox (list autocomplete) over the cards of one variant. */
export function CardTypeCombobox({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: CardTypeOption[];
  value: CardTypeOption | null;
  onChange: (o: CardTypeOption) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = `${id}-list`;

  const matches = React.useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return options
      .filter((o) => {
        const hay = o.displayName.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, MAX_SHOWN);
  }, [options, query]);

  const text = open ? query : value ? value.displayName : query;

  function pick(o: CardTypeOption) {
    onChange(o);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation(); // don't close the surrounding sheet
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${id}-opt-${matches[active].id}` : undefined}
        autoComplete="off"
        placeholder="Search bank or card"
        value={text}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching card types"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-card shadow-md"
        >
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>}
          {matches.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-opt-${o.id}`}
              role="option"
              aria-selected={value?.id === o.id}
              className={cn(
                'flex cursor-pointer flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between',
                i === active && 'bg-accent',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="min-w-0 font-medium">{o.displayName}</span>
              <CurationBadge status={o.curationStatus} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
