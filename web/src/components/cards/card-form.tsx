'use client';
import * as React from 'react';
import { Pencil, Plus } from 'lucide-react';
import { createCard, updateCard } from '@/actions/cards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SheetFooter } from '@/components/ui/sheet';
import { ErrorText, Field, FormSheet, SubmitButton, useRunAction } from '@/components/holders/form-kit';
import { CardTypeCombobox, type CardTypeOption } from './card-type-combobox';
import { CurationBadge } from './curation-badge';

export interface CardRow {
  id: string;
  holderId: string;
  bankCardTypeId: string;
  displayName: string;
  lastDigits: string | null;
  trackingFrom: string;
  active: boolean;
}
export interface VariantOption {
  id: string;
  name: string;
}
export interface HolderOption {
  id: string;
  name: string;
}

function CardFormBody({
  card,
  holders,
  types,
  variants,
  close,
}: {
  card?: CardRow;
  holders: HolderOption[];
  types: CardTypeOption[];
  variants: VariantOption[];
  close: () => void;
}) {
  const { run, pending, error, setError } = useRunAction();
  const [holderId, setHolderId] = React.useState(card?.holderId ?? holders[0]?.id ?? '');
  const [type, setType] = React.useState<CardTypeOption | null>(
    card ? (types.find((t) => t.id === card.bankCardTypeId) ?? null) : null,
  );
  // Step 1: variant (as on the RuPay portal); step 2 lists only that variant's cards.
  const [variantId, setVariantId] = React.useState(variants[0]?.id ?? '');
  const typesInVariant = React.useMemo(
    () => types.filter((t) => t.active && t.variantId === variantId),
    [types, variantId],
  );
  const [displayName, setDisplayName] = React.useState(() => {
    if (!card) return '';
    const t = types.find((x) => x.id === card.bankCardTypeId);
    if (t && card.displayName === t.displayName) return '';
    return card.displayName;
  });
  const [lastDigits, setLastDigits] = React.useState(card?.lastDigits || (card ? '0000' : ''));
  const [trackingFrom, setTrackingFrom] = React.useState(card?.trackingFrom ?? '');
  const [active, setActive] = React.useState(card?.active ?? true);

  function pickType(t: CardTypeOption) {
    setType(t);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!card && !type) {
      setError('Choose a card variant, then a bank card.');
      return;
    }
    const cleanDigits = lastDigits.trim();
    if (!cleanDigits || cleanDigits.length !== 4 || !/^\d{4}$/.test(cleanDigits)) {
      setError('Enter the last 4 digits of the card (exactly 4 digits).');
      return;
    }
    const cleanDisplayName = displayName.trim() === '' ? null : displayName.trim();
    const ok = await run(
      () =>
        card
          ? updateCard({
              id: card.id,
              holderId,
              displayName: cleanDisplayName,
              lastDigits: cleanDigits,
              trackingFrom: trackingFrom || undefined,
              active,
            })
          : createCard({
              holderId,
              bankCardTypeId: type!.id,
              displayName: cleanDisplayName,
              lastDigits: cleanDigits,
              trackingFrom: trackingFrom || undefined,
            }),
      'Could not save card. Check the card details and try again.',
    );
    if (ok) close();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4">
      <Field id="card-holder" label="Holder">
        <Select value={holderId} onValueChange={setHolderId}>
          <SelectTrigger id="card-holder" aria-label="Holder" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {holders.map((h) => (
              <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {card ? (
        <Field
          id="card-type"
          label="Card"
          hint="The card cannot be changed once set. To use a different one, add a new card."
        >
          <Input
            id="card-type"
            disabled
            aria-describedby="card-type-hint"
            value={type ? type.displayName : 'Unknown card'}
            readOnly
          />
        </Field>
      ) : (
        <>
          <Field id="card-variant" label="Card variant" hint="Pick the variant first, as on the RuPay portal.">
            <Select
              value={variantId}
              onValueChange={(v) => {
                setVariantId(v);
                setType(null);
              }}
            >
              <SelectTrigger id="card-variant" aria-label="Card variant" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            id="card-type"
            label="Bank and card"
            hint="Unverified cards may not have benefits entered yet."
          >
            <CardTypeCombobox
              key={variantId}
              id="card-type"
              options={typesInVariant}
              value={type}
              onChange={pickType}
            />
            {type && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                Selected: {type.displayName} <CurationBadge status={type.curationStatus} />
              </p>
            )}
          </Field>
        </>
      )}

      <Field
        id="card-name"
        label="Nickname (optional)"
        hint="Leave blank to use the bank card name. When set, shown in lists instead."
      >
        <div className="relative">
          <Input
            id="card-name"
            maxLength={100}
            placeholder={type?.displayName ?? 'Optional nickname'}
            value={displayName}
            aria-describedby="card-name-hint"
            onChange={(e) => setDisplayName(e.target.value)}
            className={displayName ? 'pr-14' : ''}
          />
          {displayName && (
            <button
              type="button"
              onClick={() => setDisplayName('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </Field>

      <Field id="card-digits" label="Last 4 digits" hint="Enter the last 4 digits of the card number.">
        <Input
          id="card-digits"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          placeholder="1234"
          required
          value={lastDigits}
          aria-describedby="card-digits-hint"
          onChange={(e) => setLastDigits(e.target.value.replace(/\D/g, ''))}
        />
      </Field>

      <Field
        id="card-tracking"
        label={card ? 'Tracking from' : 'Tracking from (optional)'}
        hint={card ? undefined : 'Leave blank to start today. Set an earlier date to backdate.'}
      >
        <Input
          id="card-tracking"
          type="date"
          value={trackingFrom}
          aria-describedby={card ? undefined : 'card-tracking-hint'}
          required={!!card}
          onChange={(e) => setTrackingFrom(e.target.value)}
        />
      </Field>

      {card && (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              aria-describedby="card-active-hint"
            />
            Active
          </label>
          <p id="card-active-hint" className="text-xs text-muted-foreground">
            A card with benefit history cannot be deleted; mark it inactive instead.
          </p>
        </div>
      )}

      <ErrorText>{error}</ErrorText>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>{card ? 'Save changes' : 'Add card'}</SubmitButton>
      </SheetFooter>
    </form>
  );
}

export function CardFormSheet({
  card,
  holders,
  types,
  variants,
}: {
  card?: CardRow;
  holders: HolderOption[];
  types: CardTypeOption[];
  variants: VariantOption[];
}) {
  if (card) {
    return (
      <FormSheet
        trigger={<><Pencil className="h-4 w-4" aria-hidden />Edit</>}
        triggerProps={{ variant: 'outline', size: 'sm', 'aria-label': `Edit card ${card.displayName}` }}
        title="Edit card"
      >
        {(close) => <CardFormBody card={card} holders={holders} types={types} variants={variants} close={close} />}
      </FormSheet>
    );
  }
  return (
    <FormSheet
      trigger={<><Plus className="h-4 w-4" aria-hidden />Add card</>}
      triggerProps={{ disabled: holders.length === 0 }}
      title="Add card"
      description="Benefits are generated automatically from the card."
    >
      {(close) => <CardFormBody holders={holders} types={types} variants={variants} close={close} />}
    </FormSheet>
  );
}
