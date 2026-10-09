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
  const [displayName, setDisplayName] = React.useState(card?.displayName ?? '');
  const [nameTouched, setNameTouched] = React.useState(!!card);
  const [lastDigits, setLastDigits] = React.useState(card?.lastDigits ?? '');
  const [trackingFrom, setTrackingFrom] = React.useState(card?.trackingFrom ?? '');
  const [active, setActive] = React.useState(card?.active ?? true);

  function pickType(t: CardTypeOption) {
    setType(t);
    // Decision: prefill the nickname from the card type until the user edits it.
    if (!nameTouched) setDisplayName(t.displayName.slice(0, 100));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!card && !type) {
      setError('Choose a card variant, then a bank card.');
      return;
    }
    const ok = await run(
      () =>
        card
          ? updateCard({
              id: card.id,
              holderId,
              displayName,
              lastDigits: lastDigits.trim() === '' ? null : lastDigits,
              trackingFrom: trackingFrom || undefined,
              active,
            })
          : createCard({
              holderId,
              bankCardTypeId: type!.id,
              displayName,
              lastDigits: lastDigits.trim() === '' ? null : lastDigits,
              trackingFrom: trackingFrom || undefined,
            }),
      'Could not save. Check the nickname is unique and the last digits are exactly 4 digits.',
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

      <Field id="card-name" label="Nickname" hint="Shown in lists, e.g. PNB Imperial (7825).">
        <Input
          id="card-name"
          required
          maxLength={100}
          value={displayName}
          aria-describedby="card-name-hint"
          onChange={(e) => {
            setNameTouched(true);
            setDisplayName(e.target.value);
          }}
        />
      </Field>

      <Field id="card-digits" label="Last 4 digits (optional)">
        <Input
          id="card-digits"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          placeholder="1234"
          value={lastDigits}
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
