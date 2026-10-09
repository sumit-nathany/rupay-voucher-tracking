'use client';
import * as React from 'react';
import { Check, EyeOff, Eye, Pencil, X } from 'lucide-react';
import {
  addCardTypesAction,
  createVariantAction,
  updateCardTypeAction,
  updateVariantAction,
} from '@/actions/catalog-admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ErrorText, Field, SubmitButton, useRunAction } from '@/components/holders/form-kit';
import { cn } from '@/lib/utils';

export interface VariantRow {
  id: string;
  name: string;
  active: boolean | null;
}
export interface TypeRow {
  id: string;
  displayName: string;
  variantId: string | null;
  active: boolean | null;
  curationStatus: string;
}

export function CatalogAdmin({ variants, types }: { variants: VariantRow[]; types: TypeRow[] }) {
  const tabs = variants;
  const [selected, setSelected] = React.useState(tabs[0]?.id ?? '');
  const current = tabs.find((v) => v.id === selected) ?? tabs[0];
  const countFor = (id: string) => types.filter((t) => t.variantId === id).length;

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Card variants" className="flex flex-wrap gap-2">
        {tabs.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={current?.id === v.id}
            onClick={() => setSelected(v.id)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current?.id === v.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-accent',
              v.active === false && 'opacity-60',
            )}
          >
            {v.name} <span className="opacity-70">({countFor(v.id)})</span>
          </button>
        ))}
      </div>

      {current && (
        <VariantPanel
          key={current.id}
          variant={current}
          variants={variants}
          types={types.filter((t) => t.variantId === current.id)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <BulkAdd variants={variants} defaultVariantId={current?.id || variants[0]?.id || ''} />
        <NewVariant />
      </div>
    </div>
  );
}

function VariantPanel({
  variant,
  variants,
  types,
}: {
  variant: VariantRow;
  variants: VariantRow[];
  types: TypeRow[];
}) {
  const { run, pending, error } = useRunAction();
  const [q, setQ] = React.useState('');
  const shown = types.filter((t) => t.displayName.toLowerCase().includes(q.toLowerCase().trim()));

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <InlineName value={variant.name} onSave={(name) => run(() => updateVariantAction({ id: variant.id, name }), 'Could not rename the variant.')} as="h2" />
          {variant.active === false && <Badge variant="secondary">Hidden</Badge>}
        </div>
        <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => updateVariantAction({ id: variant.id, active: variant.active === false }), 'Could not update the variant.')}
          >
            {variant.active === false ? <><Eye className="h-4 w-4" aria-hidden />Show variant</> : <><EyeOff className="h-4 w-4" aria-hidden />Hide variant</>}
          </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ErrorText>{error}</ErrorText>
        <Input
          aria-label={`Search ${variant.name} cards`}
          placeholder="Search cards"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {shown.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {types.length === 0 ? 'No cards in this variant yet. Paste a list below to add them.' : 'No cards match.'}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {shown.map((t) => (
              <TypeItem key={t.id} type={t} variants={variants} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TypeItem({ type, variants }: { type: TypeRow; variants: VariantRow[] }) {
  const { run, pending, error } = useRunAction();
  const hidden = type.active === false;
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <InlineName
          value={type.displayName}
          dim={hidden}
          onSave={(displayName) => run(() => updateCardTypeAction({ id: type.id, displayName }), 'Could not rename. This variant may already have a card with that name.')}
        />
        {hidden && <Badge variant="secondary" className="mt-1">Hidden from the add-card picker</Badge>}
        <ErrorText>{error}</ErrorText>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Select
          aria-label={`Move ${type.displayName} to another variant`}
          className="h-9 w-44"
          value={type.variantId ?? ''}
          disabled={pending}
          onChange={(e) => e.target.value && run(() => updateCardTypeAction({ id: type.id, variantId: e.target.value }), 'Could not move the card.')}
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-label={`${hidden ? 'Show' : 'Hide'} ${type.displayName}`}
          onClick={() => run(() => updateCardTypeAction({ id: type.id, active: hidden }), 'Could not update the card.')}
        >
          {hidden ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
          {hidden ? 'Show' : 'Hide'}
        </Button>
      </div>
    </li>
  );
}

/** Text that turns into an input on Edit. Saves only when the value actually changed. */
function InlineName({
  value,
  onSave,
  dim,
  as,
}: {
  value: string;
  onSave: (v: string) => Promise<boolean>;
  dim?: boolean;
  as?: 'h2';
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  if (!editing) {
    const Tag = as ?? 'span';
    return (
      <span className="inline-flex items-center gap-1.5">
        <Tag className={cn(as ? 'text-lg font-semibold' : 'text-sm font-medium', dim && 'text-muted-foreground')}>{value}</Tag>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`Rename ${value}`}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </span>
    );
  }
  const save = async () => {
    const v = draft.trim();
    if (!v || v === value) return setEditing(false);
    if (await onSave(v)) setEditing(false);
  };
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input aria-label="New name" autoFocus maxLength={200} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-9" />
      <Button type="submit" size="icon" variant="outline" className="h-9 w-9" aria-label="Save name">
        <Check className="h-4 w-4" aria-hidden />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label="Cancel rename" onClick={() => setEditing(false)}>
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </form>
  );
}

function BulkAdd({ variants, defaultVariantId }: { variants: VariantRow[]; defaultVariantId: string }) {
  const { run, pending, error, setError } = useRunAction();
  const [variantId, setVariantId] = React.useState(defaultVariantId);
  const [text, setText] = React.useState('');
  const [result, setResult] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!variantId) return setError('Create a variant first.');
    let message = '';
    const ok = await run(async () => {
      const r = await addCardTypesAction({ variantId, text });
      message = `Added ${r.added}, skipped ${r.skipped} that already existed.${r.tooLong.length ? ` ${r.tooLong.length} names over 200 characters were not added.` : ''}`;
    }, 'Could not add the cards.');
    if (ok) {
      setResult(message);
      setText('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add cards from a list</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field id="bulk-variant" label="Variant">
            <Select id="bulk-variant" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="bulk-text" label="Cards, one per line" hint="Paste straight from the RuPay portal. Blank lines and repeats are ignored.">
            <Textarea id="bulk-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          {result && <p role="status" className="rounded-md bg-teal/10 px-3 py-2 text-sm text-teal">{result}</p>}
          <div>
            <SubmitButton pending={pending}>Add cards</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NewVariant() {
  const { run, pending, error } = useRunAction();
  const [name, setName] = React.useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a variant</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => createVariantAction({ name }), 'Could not add the variant. It may already exist.')) setName('');
          }}
        >
          <Field id="variant-name" label="Name" hint="For example, RuPay Platinum Debit Card.">
            <Input id="variant-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div>
            <SubmitButton pending={pending}>Add variant</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
