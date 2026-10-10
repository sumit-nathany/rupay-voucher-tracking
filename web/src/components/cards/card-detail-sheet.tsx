'use client';
import * as React from 'react';
import { AlertTriangle, Calendar, ChevronRight, CreditCard, Hash, Loader2, Pencil, Trash2, User } from 'lucide-react';
import { deleteCard, updateCard } from '@/actions/cards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ErrorText, Field, SubmitButton, useRunAction } from '@/components/holders/form-kit';
import { formatCardLabel } from '@/domain/card-label';
import type { CardRow, HolderOption, VariantOption } from './card-form';
import type { CardTypeOption } from './card-type-combobox';
import { CurationBadge } from './curation-badge';

export function CardDetailSheet({
  card,
  holder,
  bankCardType,
  variant,
  holders,
}: {
  card: CardRow;
  holder?: HolderOption;
  bankCardType?: CardTypeOption;
  variant?: VariantOption;
  holders: HolderOption[];
  variants?: VariantOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'view' | 'edit' | 'delete'>('view');

  // Edit form state
  const { run, pending, error, setError } = useRunAction();
  const [holderId, setHolderId] = React.useState(card.holderId);
  const [displayName, setDisplayName] = React.useState(() => {
    if (bankCardType && card.displayName === bankCardType.displayName) return '';
    return card.displayName;
  });
  const [lastDigits, setLastDigits] = React.useState(card.lastDigits || '0000');
  const [trackingFrom, setTrackingFrom] = React.useState(card.trackingFrom);
  const [active, setActive] = React.useState(card.active);
  const [inactiveFrom, setInactiveFrom] = React.useState(
    card.inactiveFrom ?? (card.active === false ? card.trackingFrom : new Date().toISOString().slice(0, 10)),
  );

  // Sync state whenever open or card changes
  React.useEffect(() => {
    if (open) {
      setHolderId(card.holderId);
      setDisplayName(bankCardType && card.displayName === bankCardType.displayName ? '' : card.displayName);
      setLastDigits(card.lastDigits || '0000');
      setTrackingFrom(card.trackingFrom);
      setActive(card.active);
      setInactiveFrom(card.inactiveFrom ?? (card.active === false ? card.trackingFrom : new Date().toISOString().slice(0, 10)));
      setMode('view');
    }
  }, [open, card, bankCardType]);

  const label = formatCardLabel({
    holderName: holder?.name,
    cardName: card.displayName,
    lastDigits: card.lastDigits,
  });

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    const cleanDigits = lastDigits.trim();
    if (!cleanDigits || cleanDigits.length !== 4 || !/^\d{4}$/.test(cleanDigits)) {
      setError('Enter the last 4 digits of the card (exactly 4 digits).');
      return;
    }
    const cleanDisplayName = displayName.trim() === '' ? null : displayName.trim();
    const ok = await run(
      () =>
        updateCard({
          id: card.id,
          holderId,
          displayName: cleanDisplayName,
          lastDigits: cleanDigits,
          trackingFrom: trackingFrom || undefined,
          active,
          inactiveFrom: active ? null : (inactiveFrom || undefined),
        }),
      'Could not save card. Check the card details and try again.',
    );
    if (ok) {
      setMode('view');
    }
  }

  async function handleDelete() {
    const ok = await run(
      () => deleteCard({ id: card.id }),
      'Could not delete card. A card that has benefit history cannot be deleted; mark it inactive instead.',
    );
    if (ok) {
      setOpen(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="group w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
          aria-label={`View details for ${label}`}
        >
          <Card className="h-full overflow-hidden border border-border/70 transition-all hover:border-foreground/25 hover:shadow-xs group-hover:bg-accent/20">
            <CardContent className="flex items-center justify-between gap-4 p-4 sm:p-5">
              <div className="flex min-w-0 flex-1 items-center gap-3.5 sm:gap-4">
                <div
                  aria-hidden
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 text-primary shadow-xs transition-transform group-hover:scale-105"
                >
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-base leading-snug text-foreground group-hover:text-primary transition-colors">
                      {label}
                    </span>
                    {card.active === false ? (
                      <Badge variant="secondary" className="leading-none text-xs">
                        Inactive
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-normal text-xs leading-none">
                        Active
                      </Badge>
                    )}
                    {bankCardType && <CurationBadge status={bankCardType.curationStatus} />}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {bankCardType && bankCardType.displayName !== card.displayName && (
                      <span className="truncate max-w-[280px] font-normal">{bankCardType.displayName}</span>
                    )}
                    {!bankCardType && <span className="font-normal">Card type no longer listed</span>}
                    <span className="inline-flex items-center gap-1 font-normal">
                      <Calendar className="h-3 w-3 opacity-70" aria-hidden />
                      since {card.trackingFrom}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center pl-1 text-muted-foreground group-hover:text-foreground">
                <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </div>
            </CardContent>
          </Card>
        </button>
      </SheetTrigger>

      <SheetContent>
        {mode === 'view' && (
          <div className="flex flex-1 flex-col justify-between">
            <div className="space-y-6">
              <SheetHeader>
                <div className="flex items-center gap-3.5">
                  <div
                    aria-hidden
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/25 text-primary shadow-xs"
                  >
                    <CreditCard className="h-6 w-6" />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SheetTitle className="text-xl font-bold leading-tight truncate">
                        {card.displayName}
                      </SheetTitle>
                      {card.active === false ? (
                        <Badge variant="secondary" className="text-xs">
                          Inactive{card.inactiveFrom ? ` (since ${card.inactiveFrom})` : ''}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium text-xs">
                          Active
                        </Badge>
                      )}
                    </div>
                    <SheetDescription className="truncate">{label}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-4">
                {/* Visual Card Banner */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-5 text-white shadow-md dark:border dark:border-white/10">
                  <div className="flex items-center justify-between text-xs text-white/70">
                    <span className="font-medium tracking-wide uppercase">{variant?.name ?? 'RuPay'}</span>
                    {bankCardType && <CurationBadge status={bankCardType.curationStatus} />}
                  </div>
                  <div className="my-4">
                    <p className="font-mono text-lg tracking-widest text-white/90">
                      •••• •••• •••• {card.lastDigits || '••••'}
                    </p>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-white/60">Cardholder</p>
                      <p className="font-medium text-sm text-white">{holder?.name ?? 'Unassigned'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-white/60">
                        {card.active === false ? 'Inactive Since' : 'Tracking Since'}
                      </p>
                      <p className="font-medium text-xs text-white/90">
                        {card.active === false ? (card.inactiveFrom ?? card.trackingFrom) : card.trackingFrom}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Details Section */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Card Properties</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" /> Holder
                      </span>
                      <span className="font-medium text-foreground">{holder?.name ?? 'None'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <CreditCard className="h-3.5 w-3.5" /> Bank Card Type
                      </span>
                      <span className="font-medium text-foreground text-right truncate max-w-[220px]">
                        {bankCardType?.displayName ?? 'Not listed'}
                      </span>
                    </div>
                    {variant?.name && (
                      <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                        <span className="text-muted-foreground">Variant</span>
                        <span className="font-medium text-foreground">{variant.name}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Hash className="h-3.5 w-3.5" /> Last 4 Digits
                      </span>
                      <span className="font-mono font-medium text-foreground">{card.lastDigits ?? 'None'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                      <span className="text-muted-foreground">Nickname</span>
                      <span className="font-medium text-foreground">
                        {bankCardType && card.displayName === bankCardType.displayName ? (
                          <span className="text-muted-foreground font-normal">None (using bank name)</span>
                        ) : (
                          card.displayName
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" /> Tracking From
                      </span>
                      <span className="font-medium text-foreground">{card.trackingFrom}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1">
                      <span className="text-muted-foreground">Tracking Status</span>
                      <span className="font-medium text-foreground">
                        {card.active ? (
                          'Active — vouchers generated'
                        ) : (
                          `Inactive${card.inactiveFrom ? ` since ${card.inactiveFrom}` : ''} — non-ordered benefits removed`
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <SheetFooter className="mt-8 pt-4 border-t border-border/50 flex flex-row items-center justify-between gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive border-border/70 gap-1.5"
                onClick={() => setMode('delete')}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button type="button" className="gap-1.5" onClick={() => setMode('edit')}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              </div>
            </SheetFooter>
          </div>
        )}

        {mode === 'edit' && (
          <form onSubmit={handleUpdate} className="flex flex-1 flex-col justify-between">
            <div className="space-y-5">
              <SheetHeader>
                <SheetTitle>Edit Card</SheetTitle>
                <SheetDescription>Update holder, nickname, card digits, or tracking status.</SheetDescription>
              </SheetHeader>

              <div className="space-y-4">
                <Field id="card-holder" label="Holder">
                  <Select value={holderId} onValueChange={setHolderId}>
                    <SelectTrigger id="card-holder" aria-label="Holder" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {holders.map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field
                  id="card-type"
                  label="Card Type"
                  hint="The card type cannot be changed once set. To track a different card, add a new card."
                >
                  <Input
                    id="card-type"
                    disabled
                    aria-describedby="card-type-hint"
                    value={bankCardType ? bankCardType.displayName : 'Unknown card'}
                    readOnly
                  />
                </Field>

                <Field
                  id="card-name"
                  label="Nickname (optional)"
                  hint="Leave blank to use the bank card name. When set, shown in lists instead."
                >
                  <div className="relative">
                    <Input
                      id="card-name"
                      maxLength={100}
                      placeholder={bankCardType?.displayName ?? 'Optional nickname'}
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

                <Field id="card-tracking" label="Tracking from">
                  <Input
                    id="card-tracking"
                    type="date"
                    value={trackingFrom}
                    required
                    onChange={(e) => setTrackingFrom(e.target.value)}
                  />
                </Field>

                <div className="flex flex-col gap-3 rounded-lg border border-border/70 p-3 bg-muted/20">
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={active}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setActive(next);
                          if (!next && !inactiveFrom) {
                            setInactiveFrom(new Date().toISOString().slice(0, 10));
                          }
                        }}
                        aria-describedby="card-active-hint"
                      />
                      Active
                    </label>
                    <p id="card-active-hint" className="text-xs text-muted-foreground">
                      A card with benefit history cannot be deleted; mark it inactive instead.
                    </p>
                  </div>

                  {!active && (
                    <Field
                      id="edit-card-inactive-from"
                      label="Inactive from"
                      hint="Date this card became inactive. Non-ordered benefits from this date onwards will be removed. Past ordered vouchers are preserved."
                    >
                      <Input
                        id="edit-card-inactive-from"
                        type="date"
                        required={!active}
                        value={inactiveFrom}
                        onChange={(e) => setInactiveFrom(e.target.value)}
                      />
                    </Field>
                  )}
                </div>

                <ErrorText>{error}</ErrorText>
              </div>
            </div>

            <SheetFooter className="mt-8 pt-4 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setMode('view')}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>Save changes</SubmitButton>
            </SheetFooter>
          </form>
        )}

        {mode === 'delete' && (
          <div className="flex flex-1 flex-col justify-between">
            <div className="space-y-5">
              <SheetHeader>
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  <SheetTitle className="text-destructive">Delete Card?</SheetTitle>
                </div>
                <SheetDescription>{label}</SheetDescription>
              </SheetHeader>

              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground space-y-2">
                <p className="font-semibold text-destructive">Warning</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  This permanently removes the card. A card that already has benefit vouchers or history cannot be deleted; mark it inactive instead.
                </p>
              </div>

              <ErrorText>{error}</ErrorText>
            </div>

            <SheetFooter className="mt-8 pt-4 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setMode('view')}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={handleDelete}
                className="gap-1.5"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete permanently
              </Button>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
