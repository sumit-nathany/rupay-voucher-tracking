'use client';
import * as React from 'react';
import { Check, ChevronDown, ChevronRight, EyeOff, Eye, Loader2, Pencil, X } from 'lucide-react';
import {
  addCardTypesAction,
  createVariantAction,
  listCardTypeBenefitsAction,
  updateCardTypeAction,
  updateVariantAction,
} from '@/actions/catalog-admin';
import { CurationBadge } from '@/components/cards/curation-badge';
import { formatDate, formatINR } from '@/components/dashboard/format';
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

type CatalogBenefit = Awaited<ReturnType<typeof listCardTypeBenefitsAction>>[number];

export function CatalogAdmin({
  variants,
  types,
  benefitCountByTypeId,
}: {
  variants: VariantRow[];
  types: TypeRow[];
  benefitCountByTypeId: Record<string, number>;
}) {
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
          benefitCountByTypeId={benefitCountByTypeId}
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
  benefitCountByTypeId,
}: {
  variant: VariantRow;
  variants: VariantRow[];
  types: TypeRow[];
  benefitCountByTypeId: Record<string, number>;
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
              <TypeItem
                key={t.id}
                type={t}
                variants={variants}
                benefitCount={benefitCountByTypeId[t.id] ?? 0}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TypeItem({ type, variants, benefitCount }: { type: TypeRow; variants: VariantRow[]; benefitCount: number }) {
  const { run, pending, error } = useRunAction();
  const hidden = type.active === false;
  const [open, setOpen] = React.useState(false);
  const [benefits, setBenefits] = React.useState<CatalogBenefit[] | null>(null);
  const [benefitsLoading, setBenefitsLoading] = React.useState(false);
  const [benefitsError, setBenefitsError] = React.useState<string | null>(null);

  const loadBenefits = React.useCallback(async () => {
    if (benefits !== null) return;
    setBenefitsLoading(true);
    setBenefitsError(null);
    try {
      setBenefits(await listCardTypeBenefitsAction(type.id));
    } catch {
      setBenefitsError('Could not load benefits for this card.');
    } finally {
      setBenefitsLoading(false);
    }
  }, [benefits, type.id]);

  const toggleBenefits = () => {
    const next = !open;
    setOpen(next);
    if (next) void loadBenefits();
  };

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-0.5 h-8 w-8 shrink-0"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} benefits for ${type.displayName}`}
            onClick={toggleBenefits}
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </Button>
          <div className="min-w-0">
            <InlineName
              value={type.displayName}
              dim={hidden}
              onSave={(displayName) => run(() => updateCardTypeAction({ id: type.id, displayName }), 'Could not rename. This variant may already have a card with that name.')}
            />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <CurationBadge status={type.curationStatus} />
              <span className="text-xs text-muted-foreground">
                {benefitCount === 0 ? 'No benefits in catalog' : `${benefitCount} benefit${benefitCount === 1 ? '' : 's'}`}
              </span>
            </div>
            {hidden && <Badge variant="secondary" className="mt-1">Hidden from the add-card picker</Badge>}
            <ErrorText>{error}</ErrorText>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pl-10 sm:pl-0">
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
      </div>
      {open && (
        <div className="mt-3 ml-10 rounded-md border bg-muted/30 p-3">
          {benefitsLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading benefits…
            </p>
          )}
          {benefitsError && <ErrorText>{benefitsError}</ErrorText>}
          {!benefitsLoading && benefits && benefits.length === 0 && (
            <p className="text-sm text-muted-foreground">No benefits have been entered for this card yet.</p>
          )}
          {!benefitsLoading && benefits && benefits.length > 0 && (
            <ul className="space-y-3">
              {benefits.map((b) => (
                <BenefitCatalogRow key={b.benefitId} benefit={b} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function BenefitCatalogRow({ benefit: b }: { benefit: CatalogBenefit }) {
  const value =
    b.defaultCashValue != null && b.defaultCashValue !== '' ? formatINR(Number(b.defaultCashValue)) : null;
  const ended = b.effectiveTo !== null;
  const freq =
    b.instanceCount > 1 ? `${b.frequency} · ${b.instanceCount}× per period` : b.frequency;
  const window =
    ended
      ? `${formatDate(b.effectiveFrom)} – ${formatDate(b.effectiveTo!)}`
      : `From ${formatDate(b.effectiveFrom)}`;
  return (
    <li className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          <span className="text-muted-foreground">{b.benefitType}</span>
          {b.benefitProvider ? ` · ${b.benefitProvider}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{freq}</Badge>
          {ended && <Badge variant="secondary">Ended</Badge>}
          {b.versionCount > 1 && (
            <Badge variant="secondary" title="This benefit has more than one catalog version">
              {b.versionCount} versions
            </Badge>
          )}
        </div>
      </div>
      <p className="mt-0.5 text-sm">{b.exactBenefit}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {window}
        {value ? ` · Default ${value}` : ''}
      </p>
      {b.options.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-md border bg-card px-2 py-1.5 text-xs">
          <li className="font-medium text-muted-foreground">Redeem any one ({b.options.length} choices)</li>
          {b.options.map((o) => (
            <li key={`${o.provider}-${o.offerName}`} className="flex justify-between gap-2">
              <span>{o.provider}: {o.offerName}</span>
              {o.cashValue != null && o.cashValue !== '' && (
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatINR(Number(o.cashValue))}</span>
              )}
            </li>
          ))}
        </ul>
      )}
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
