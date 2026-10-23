'use client';
import * as React from 'react';
import { Check, ChevronDown, ChevronRight, EyeOff, Eye, Loader2, Pencil, X, RotateCcw } from 'lucide-react';
import {
  addCardTypesAction,
  correctVersionAction,
  createVariantAction,
  listCardTypeBenefitsAction,
  updateCardTypeAction,
  updateVariantAction,
  previewFrequencyChangeAction,
  executeFrequencyChangeAction,
} from '@/actions/catalog-admin';
import type { OfferKind, FrequencyChangePreview, WorkspaceImpact } from '@/domain/catalog-admin';
import { type Frequency } from '@/lib/periods';
import { CurationBadge } from '@/components/cards/curation-badge';
import { formatDate, formatINR } from '@/components/dashboard/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { ErrorText, Field, SubmitButton, useRunAction, messageFor } from '@/components/holders/form-kit';
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

export type CatalogAdminMode = 'view' | 'edit';

export function CatalogAdmin({
  mode,
  variants,
  types,
  benefitCountByTypeId,
}: {
  mode: CatalogAdminMode;
  variants: VariantRow[];
  types: TypeRow[];
  benefitCountByTypeId: Record<string, number>;
}) {
  const editing = mode === 'edit';
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
          mode={mode}
          variant={current}
          variants={variants}
          types={types.filter((t) => t.variantId === current.id)}
          benefitCountByTypeId={benefitCountByTypeId}
        />
      )}

      {editing && (
        <div className="grid gap-6 lg:grid-cols-2">
          <BulkAdd variants={variants} defaultVariantId={current?.id || variants[0]?.id || ''} />
          <NewVariant />
        </div>
      )}
    </div>
  );
}

function VariantPanel({
  mode,
  variant,
  variants,
  types,
  benefitCountByTypeId,
}: {
  mode: CatalogAdminMode;
  variant: VariantRow;
  variants: VariantRow[];
  types: TypeRow[];
  benefitCountByTypeId: Record<string, number>;
}) {
  const editing = mode === 'edit';
  const { run, pending, error } = useRunAction();
  const [q, setQ] = React.useState('');
  const shown = types.filter((t) => t.displayName.toLowerCase().includes(q.toLowerCase().trim()));

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <InlineName value={variant.name} onSave={(name) => run(() => updateVariantAction({ id: variant.id, name }), 'Could not rename the variant.')} as="h2" />
          ) : (
            <CardTitle className="text-lg">{variant.name}</CardTitle>
          )}
          {variant.active === false && <Badge variant="secondary">Hidden</Badge>}
        </div>
        {editing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => updateVariantAction({ id: variant.id, active: variant.active === false }), 'Could not update the variant.')}
          >
            {variant.active === false ? <><Eye className="h-4 w-4" aria-hidden />Show variant</> : <><EyeOff className="h-4 w-4" aria-hidden />Hide variant</>}
          </Button>
        )}
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
            {types.length === 0
              ? editing
                ? 'No cards in this variant yet. Paste a list below to add them.'
                : 'No cards in this variant yet.'
              : 'No cards match.'}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {shown.map((t) => (
              <TypeItem
                key={t.id}
                mode={mode}
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

function TypeItem({
  mode,
  type,
  variants,
  benefitCount,
}: {
  mode: CatalogAdminMode;
  type: TypeRow;
  variants: VariantRow[];
  benefitCount: number;
}) {
  const editing = mode === 'edit';
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
            {editing ? (
              <InlineName
                value={type.displayName}
                dim={hidden}
                onSave={(displayName) => run(() => updateCardTypeAction({ id: type.id, displayName }), 'Could not rename. This variant may already have a card with that name.')}
              />
            ) : (
              <p className={cn('text-sm font-medium', hidden && 'text-muted-foreground')}>{type.displayName}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <CurationBadge status={type.curationStatus} />
              <span className="text-xs text-muted-foreground">
                {benefitCount === 0 ? 'No benefits in catalog' : `${benefitCount} benefit${benefitCount === 1 ? '' : 's'}`}
              </span>
            </div>
            {hidden && <Badge variant="secondary" className="mt-1">Hidden from the add-card picker</Badge>}
            {editing && <ErrorText>{error}</ErrorText>}
          </div>
        </div>
        {editing && (
          <div className="flex shrink-0 items-center gap-2 pl-10 sm:pl-0">
            <Select
              value={type.variantId ?? ''}
              disabled={pending}
              onValueChange={(v) => v && run(() => updateCardTypeAction({ id: type.id, variantId: v }), 'Could not move the card.')}
            >
              <SelectTrigger aria-label={`Move ${type.displayName} to another variant`} className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
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
        )}
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
                <BenefitCatalogRow
                  key={b.benefitId}
                  mode={mode}
                  benefit={b}
                  onOfferKindChange={(offerKind) =>
                    setBenefits((prev) =>
                      prev?.map((row) => (row.benefitId === b.benefitId ? { ...row, offerKind } : row)) ?? null,
                    )
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function BenefitCatalogRow({
  mode,
  benefit: b,
  onOfferKindChange,
}: {
  mode: CatalogAdminMode;
  benefit: CatalogBenefit;
  onOfferKindChange: (offerKind: OfferKind) => void;
}) {
  const editing = mode === 'edit';
  const { run, pending, error } = useRunAction();
  const value =
    b.defaultCashValue != null && b.defaultCashValue !== '' ? formatINR(Number(b.defaultCashValue)) : null;
  const ended = b.effectiveTo !== null;
  const freq =
    b.instanceCount > 1 ? `${b.frequency} · ${b.instanceCount}× per period` : b.frequency;
  const window =
    ended
      ? `${formatDate(b.effectiveFrom)} – ${formatDate(b.effectiveTo!)}`
      : `From ${formatDate(b.effectiveFrom)}`;

  const setOfferKind = (next: OfferKind) => {
    if (next === b.offerKind) return;
    run(async () => {
      await correctVersionAction({ versionId: b.versionId, offerKind: next });
      onOfferKindChange(next);
      return true;
    }, 'Could not update gift vs discount.');
  };

  return (
    <li className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          <span className="text-muted-foreground">{b.benefitType}</span>
          {b.benefitProvider ? ` · ${b.benefitProvider}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {editing ? (
            <Select value={b.offerKind} disabled={pending} onValueChange={(v) => setOfferKind(v as OfferKind)}>
              <SelectTrigger aria-label="Offer type" className="h-8 w-[11.5rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="voucher">Gift voucher</SelectItem>
                <SelectItem value="discount">Discount coupon</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            b.offerKind === 'discount' && (
              <Badge variant="secondary" title="Discount coupon — hidden from the default benefits list">
                Discount coupon
              </Badge>
            )
          )}
          <Badge variant="outline">{freq}</Badge>
          {ended && <Badge variant="secondary">Ended</Badge>}
          {b.versionCount > 1 && (
            <Badge variant="secondary" title="This benefit has more than one catalog version">
              {b.versionCount} versions
            </Badge>
          )}
          {editing && (
            <FrequencyChangeTrigger benefit={b} />
          )}
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
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

function FrequencyChangeTrigger({ benefit }: { benefit: CatalogBenefit }) {
  const [open, setOpen] = React.useState(false);
  const [newFrequency, setNewFrequency] = React.useState<Frequency>('Annual');
  const [effectiveFrom, setEffectiveFrom] = React.useState('');
  const [instanceHandling, setInstanceHandling] =
    React.useState<'keep' | 'regenerate_current' | 'regenerate_all_future' | 'migrate'>('migrate');
  const [preview, setPreview] = React.useState<FrequencyChangePreview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const { run: runExecute, pending: executing, error: executeError, setError: setExecuteError } = useRunAction();

  React.useEffect(() => {
    if (open) {
      setPreview(null);
      setPreviewError(null);
      setExecuteError(null);
      setNewFrequency(benefit.frequency as Frequency);
      setEffectiveFrom('');
      setInstanceHandling('migrate');
    }
  }, [open, benefit, setExecuteError]);

  const canPreview = newFrequency !== benefit.frequency && !!effectiveFrom;

  async function showPreview() {
    if (!canPreview) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await previewFrequencyChangeAction({
        benefitId: benefit.benefitId,
        newFrequency,
        effectiveFrom,
        instanceHandling,
      });
      setPreview(result);
    } catch (e) {
      setPreviewError(messageFor(e, 'Could not generate preview.'));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleExecute() {
    if (!preview) return;
    await runExecute(
      async () => {
        await executeFrequencyChangeAction({
          benefitId: benefit.benefitId,
          newFrequency,
          effectiveFrom,
          instanceHandling,
        });
      },
      'Could not change frequency.',
    );
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Change frequency for ${benefit.benefitType}${benefit.benefitProvider ? ` ${benefit.benefitProvider}` : ''}`}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Change frequency</SheetTitle>
          <SheetDescription>
            {benefit.benefitType}
            {benefit.benefitProvider ? ` · ${benefit.benefitProvider}` : ''}
            <span className="block text-xs text-muted-foreground mt-1">
              Current frequency: {benefit.frequency}
            </span>
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-4">
          <Field id="new-frequency" label="New frequency">
            <Select value={newFrequency} onValueChange={(v) => setNewFrequency(v as Frequency)}>
              <SelectTrigger id="new-frequency" aria-label="New frequency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Annual">Annual</SelectItem>
                <SelectItem value="6 months">Half-yearly</SelectItem>
                <SelectItem value="Quarterly">Quarterly</SelectItem>
                <SelectItem value="Monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="effective-from"
            label="Effective from"
            hint="Old instances through the day before this date are kept as-is."
          >
            <Input
              id="effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              required
              min={benefit.effectiveFrom}
            />
          </Field>

          <Field
            id="instance-handling"
            label="Instance handling"
            hint="How to handle existing benefit instances after the frequency change."
          >
            <Select
              value={instanceHandling}
              onValueChange={(v) =>
                setInstanceHandling(
                  v as 'keep' | 'regenerate_current' | 'regenerate_all_future' | 'migrate',
                )
              }
            >
              <SelectTrigger id="instance-handling" aria-label="Instance handling" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Keep existing instances (no changes)</SelectItem>
                <SelectItem value="regenerate_current">Regenerate current period instances</SelectItem>
                <SelectItem value="regenerate_all_future">Regenerate all future period instances</SelectItem>
                <SelectItem value="migrate">Migrate with history (preserve order/code state)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {!preview && (
            <Button
              type="button"
              variant="outline"
              disabled={!canPreview || previewLoading}
              onClick={showPreview}
            >
              {previewLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Generating preview…
                </>
              ) : (
                'Show impact preview'
              )}
            </Button>
          )}

          <ErrorText>{previewError}</ErrorText>

          {preview && (
            <FrequencyChangePreviewContent preview={preview} instanceHandling={instanceHandling} />
          )}
        </div>

        <SheetFooter className="mt-6">
          <ErrorText>{executeError}</ErrorText>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={executing}
          >
            Cancel
          </Button>
          <Button
            variant={preview?.warnings.length ? 'secondary' : 'default'}
            disabled={!preview || executing || (preview?.warnings.length ?? 0) > 0}
            onClick={handleExecute}
          >
            {executing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Change frequency
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FrequencyChangePreviewContent({
  preview,
  instanceHandling,
}: {
  preview: FrequencyChangePreview;
  instanceHandling: 'keep' | 'regenerate_current' | 'regenerate_all_future' | 'migrate';
}) {
  const modeSummary =
    instanceHandling === 'keep'
      ? preview.summary.currentPeriod.keep
      : instanceHandling === 'regenerate_current'
        ? preview.summary.currentPeriod.regenerate_current
        : instanceHandling === 'regenerate_all_future'
          ? preview.summary.currentPeriod.regenerate_all_future
          : preview.summary.currentPeriod.migrate;

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-muted/40 p-3 text-sm">
        <p>
          <span className="font-medium">Old frequency:</span> {preview.oldFrequency} →{' '}
          <span className="font-medium">New frequency:</span> {preview.newFrequency}
        </p>
        <p>
          <span className="font-medium">Effective from:</span> {preview.effectiveFrom}
        </p>
        <p className="mt-1">
          <span className="font-medium">{preview.summary.totalWorkspaces}</span> workspace
          {preview.summary.totalWorkspaces === 1 ? '' : 's'} ·{' '}
          <span className="font-medium">{preview.summary.totalCards}</span> card
          {preview.summary.totalCards === 1 ? '' : 's'} affected
        </p>
      </div>

      {preview.warnings.length > 0 && (
        <div className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <ul className="list-disc list-inside space-y-0.5">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {modeSummary && (
        <div className="rounded-md bg-blue-500/5 p-3 text-xs">
          <span className="font-medium">Selected mode ({instanceHandling}) outcome:</span>{' '}
          Archive {modeSummary.archive} · Add {modeSummary.add} · Preserve {modeSummary.preserve}
        </div>
      )}

      {preview.affectedWorkspaces.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-2 py-1.5 text-left">Workspace</th>
                <th className="px-2 py-1.5 text-right">Cards</th>
                <th className="px-2 py-1.5 text-right">Current period</th>
                <th className="px-2 py-1.5 text-right">Future periods</th>
              </tr>
            </thead>
            <tbody>
              {preview.affectedWorkspaces.map((w: WorkspaceImpact) => (
                <tr key={w.workspaceId} className="border-t">
                  <td className="px-2 py-1">{w.workspaceName}</td>
                  <td className="px-2 py-1 text-right">{w.cardCount}</td>
                  <td className="px-2 py-1 text-right text-muted-foreground">
                    {w.currentPeriod.totalInstances} instance
                    {w.currentPeriod.totalInstances === 1 ? '' : 's'}
                  </td>
                  <td className="px-2 py-1 text-right text-muted-foreground">
                    {w.futurePeriods.totalInstances} instance
                    {w.futurePeriods.totalInstances === 1 ? '' : 's'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger id="bulk-variant" aria-label="Variant" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="bulk-text" label="Cards, one per line" hint="Paste straight from the RuPay portal. Blank lines and repeats are ignored.">
            <Textarea id="bulk-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          {result && <p role="status" className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">{result}</p>}
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
