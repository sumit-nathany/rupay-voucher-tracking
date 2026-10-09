'use client';
import * as React from 'react';
import { Pencil, Plus } from 'lucide-react';
import { createOverride, updateOverride } from '@/actions/overrides';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SheetFooter } from '@/components/ui/sheet';
import { ErrorText, Field, FormSheet, SubmitButton, useRunAction } from '@/components/holders/form-kit';

export interface OverrideRow {
  id: string;
  kind: string;
  benefitType: string | null;
  benefitProvider: string | null;
  exactBenefit: string | null;
  frequency: string | null;
  instanceCount: number | null;
  defaultCashValue: string | null;
}
export interface CardOption {
  id: string;
  name: string;
}

const FREQUENCIES = ['Annual', '6 months', 'Quarterly', 'Monthly'] as const;

function OverrideFormBody({
  override,
  cards,
  close,
}: {
  override?: OverrideRow;
  cards: CardOption[];
  close: () => void;
}) {
  const { run, pending, error, setError } = useRunAction();
  const editing = !!override;
  const [cardId, setCardId] = React.useState(cards[0]?.id ?? '');
  const [benefitType, setBenefitType] = React.useState(override?.benefitType ?? '');
  const [provider, setProvider] = React.useState(override?.benefitProvider ?? '');
  const [exact, setExact] = React.useState(override?.exactBenefit ?? '');
  const [frequency, setFrequency] = React.useState(override?.frequency ?? 'Quarterly');
  const [count, setCount] = React.useState(String(override?.instanceCount ?? 1));
  const [cash, setCash] = React.useState(override?.defaultCashValue ?? '');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(count);
    if (!editing && (!Number.isInteger(n) || n < 1)) {
      setError('Instances per period must be a whole number, at least 1.');
      return;
    }
    const cashValue = cash.trim() === '' ? null : cash.trim();
    const ok = await run(
      () =>
        override
          ? updateOverride({ id: override.id, defaultCashValue: cashValue })
          : createOverride({
              kind: 'add',
              cardId,
              benefitType,
              benefitProvider: provider,
              exactBenefit: exact,
              frequency,
              instanceCount: n,
              defaultCashValue: cashValue,
            }),
      'Could not save. This benefit may already be added for the card, or the cash value is not a valid amount.',
    );
    if (ok) close();
  }

  const locked = editing;
  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4">
      {locked && (
        <p className="text-xs text-muted-foreground">
          Only the cash value can be changed. To change anything else, delete this override and add a new one.
        </p>
      )}
      {!editing && (
        <Field id="ov-card" label="Card">
          <Select value={cardId} onValueChange={setCardId}>
            <SelectTrigger id="ov-card" aria-label="Card" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cards.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field id="ov-type" label="Benefit type">
        <Input id="ov-type" required maxLength={100} disabled={locked} value={benefitType} onChange={(e) => setBenefitType(e.target.value)} placeholder="e.g. Shopping" />
      </Field>
      <Field id="ov-provider" label="Provider (optional)">
        <Input id="ov-provider" maxLength={100} disabled={locked} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. Big Basket" />
      </Field>
      <Field id="ov-exact" label="Exact benefit">
        <Input id="ov-exact" required maxLength={500} disabled={locked} value={exact} onChange={(e) => setExact(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="ov-freq" label="Frequency">
          <Select value={frequency} onValueChange={setFrequency} disabled={locked}>
            <SelectTrigger id="ov-freq" aria-label="Frequency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCIES.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="ov-count" label="Per period">
          <Input id="ov-count" type="number" inputMode="numeric" min={1} step={1} required disabled={locked} value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
      </div>
      <Field id="ov-cash" label="Default cash value, INR (optional)">
        <Input id="ov-cash" inputMode="decimal" placeholder="e.g. 500" value={cash} onChange={(e) => setCash(e.target.value)} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>{editing ? 'Save changes' : 'Add override'}</SubmitButton>
      </SheetFooter>
    </form>
  );
}

export function OverrideFormSheet({ override, cards }: { override?: OverrideRow; cards: CardOption[] }) {
  if (override) {
    return (
      <FormSheet
        trigger={<><Pencil className="h-4 w-4" aria-hidden />Edit</>}
        triggerProps={{ variant: 'outline', size: 'sm', 'aria-label': `Edit override ${override.exactBenefit ?? ''}` }}
        title="Edit override"
      >
        {(close) => <OverrideFormBody override={override} cards={cards} close={close} />}
      </FormSheet>
    );
  }
  return (
    <FormSheet
      trigger={<><Plus className="h-4 w-4" aria-hidden />Add benefit</>}
      triggerProps={{ disabled: cards.length === 0 }}
      title="Add a missing benefit"
      description="Adds a benefit the shared catalog is missing, for one card only."
    >
      {(close) => <OverrideFormBody cards={cards} close={close} />}
    </FormSheet>
  );
}
