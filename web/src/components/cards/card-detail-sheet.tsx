'use client';
import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Calendar, CheckCircle2, ChevronRight, CreditCard, Hash, KeyRound, Loader2, Pencil, Trash2, User, Lock, ShieldCheck, Pause, Play, Bot } from 'lucide-react';
import { deleteCard, updateCard, toggleCardAutomationAction } from '@/actions/cards';
import { setCardPortalAccountsAction } from '@/actions/automation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { cn } from '@/lib/utils';
import type { CardRow, HolderOption, VariantOption } from './card-form';
import type { CardTypeOption } from './card-type-combobox';
import { CurationBadge } from './curation-badge';

export interface CardPortalAccountOption {
  id: string;
  label: string;
  phoneNumber: string | null;
  active: boolean;
  status: string;
}

export interface CardMappingOption {
  id: string;
  portalAccountId: string;
  cardId: string;
}

export function CardDetailSheet({
  card,
  holder,
  bankCardType,
  variant,
  holders,
  accounts = [],
  mappings = [],
}: {
  card: CardRow;
  holder?: HolderOption;
  bankCardType?: CardTypeOption;
  variant?: VariantOption;
  holders: HolderOption[];
  variants?: VariantOption[];
  accounts?: CardPortalAccountOption[];
  mappings?: CardMappingOption[];
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
  const [automationEnabled, setAutomationEnabled] = React.useState(card.automationEnabled ?? true);
  const [inactiveFrom, setInactiveFrom] = React.useState(
    card.inactiveFrom ?? (card.active === false ? card.trackingFrom : new Date().toISOString().slice(0, 10)),
  );

  // Full card checkout details state
  const [cardNumber, setCardNumber] = React.useState('');
  const [expiryMonth, setExpiryMonth] = React.useState('');
  const [expiryYear, setExpiryYear] = React.useState('');
  const [cvv, setCvv] = React.useState('');
  const [nameOnCard, setNameOnCard] = React.useState('');

  // Portal account mapping state
  const [localMappings, setLocalMappings] = React.useState<CardMappingOption[]>(mappings);
  const [selectedAccountIdToLink, setSelectedAccountIdToLink] = React.useState<string>('');
  const [editPortalAccountId, setEditPortalAccountId] = React.useState<string>('');
  const [feedback, setFeedback] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLocalMappings(mappings);
  }, [mappings]);

  function handleCardNumberChange(val: string) {
    const raw = val.replace(/\D/g, '').slice(0, 16);
    const formatted = raw.replace(/(\d{4})(?=\d)/g, '$1 ');
    setCardNumber(formatted);
    if (raw.length >= 4) {
      setLastDigits(raw.slice(-4));
    }
  }

  // Sync state whenever open or card changes
  React.useEffect(() => {
    if (open) {
      setHolderId(card.holderId);
      setDisplayName(bankCardType && card.displayName === bankCardType.displayName ? '' : card.displayName);
      setLastDigits(card.lastDigits || '0000');
      setTrackingFrom(card.trackingFrom);
      setActive(card.active);
      setAutomationEnabled(card.automationEnabled ?? true);
      setInactiveFrom(card.inactiveFrom ?? (card.active === false ? card.trackingFrom : new Date().toISOString().slice(0, 10)));
      setCardNumber('');
      setExpiryMonth('');
      setExpiryYear('');
      setCvv('');
      setNameOnCard(card.paymentSummary?.nameOnCard ?? '');
      setSelectedAccountIdToLink('');
      const currentMappings = mappings.filter((m) => m.cardId === card.id);
      setEditPortalAccountId(currentMappings[0]?.portalAccountId ?? '');
      setFeedback(null);
      setMode('view');
    }
  }, [open, card, bankCardType, mappings]);

  const label = formatCardLabel({
    holderName: holder?.name,
    cardName: card.displayName,
    lastDigits: card.lastDigits,
  });

  const currentCardMappings = localMappings.filter((m) => m.cardId === card.id);
  const linkedAccountIds = currentCardMappings.map((m) => m.portalAccountId);
  const linkedAccounts = accounts.filter((a) => linkedAccountIds.includes(a.id));
  const activeUnlinkedAccounts = accounts.filter((a) => a.active && !linkedAccountIds.includes(a.id));

  const hasValidPaymentDetails = Boolean(
    card.paymentSummary &&
      !card.paymentDetailsCorrupted &&
      (card.paymentSummary.mode === 'saved_card'
        ? card.paymentSummary.hasCvv
        : card.paymentSummary.maskedCardNumber && card.paymentSummary.hasCvv && card.paymentSummary.expirySummary),
  );

  async function handleLinkAccount(accountIdToLink?: string) {
    const targetAccountId = accountIdToLink || selectedAccountIdToLink;
    if (!targetAccountId) return;
    setError(null);
    setFeedback(null);
    const targetAcc = accounts.find((a) => a.id === targetAccountId);
    const nextAccountIds = Array.from(new Set([...linkedAccountIds, targetAccountId]));
    const ok = await run(
      () =>
        setCardPortalAccountsAction({
          cardId: card.id,
          portalAccountIds: nextAccountIds,
        }),
      'Failed to link card to RuPay account',
    );
    if (ok) {
      setLocalMappings((prev) => [
        ...prev.filter((m) => !(m.cardId === card.id && m.portalAccountId === targetAccountId)),
        {
          id: crypto.randomUUID(),
          cardId: card.id,
          portalAccountId: targetAccountId,
        },
      ]);
      setSelectedAccountIdToLink('');
      setFeedback(`Card successfully linked to "${targetAcc?.label ?? 'RuPay account'}".`);
    }
  }

  async function handleUnlinkAccount(portalAccountId: string, accountLabel: string) {
    if (!confirm(`Unlink this card from "${accountLabel}"?`)) return;
    setError(null);
    setFeedback(null);
    const nextAccountIds = linkedAccountIds.filter((id) => id !== portalAccountId);
    const ok = await run(
      () =>
        setCardPortalAccountsAction({
          cardId: card.id,
          portalAccountIds: nextAccountIds,
        }),
      'Failed to unlink card from RuPay account',
    );
    if (ok) {
      setLocalMappings((prev) =>
        prev.filter((m) => !(m.cardId === card.id && m.portalAccountId === portalAccountId)),
      );
      setFeedback(`Card unlinked from "${accountLabel}".`);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    const cleanDigits = lastDigits.trim();
    if (!cleanDigits || cleanDigits.length !== 4 || !/^\d{4}$/.test(cleanDigits)) {
      setError('Enter the last 4 digits of the card (exactly 4 digits).');
      return;
    }
    const cleanDisplayName = displayName.trim() === '' ? null : displayName.trim();

    let paymentDetails = undefined;
    const cleanCardNumber = cardNumber.replace(/\s+/g, '');
    if (cleanCardNumber || cvv || expiryMonth || expiryYear || nameOnCard) {
      paymentDetails = {
        version: 1 as const,
        mode: 'full' as const,
        cardNumber: cleanCardNumber || undefined,
        expiryMonth: expiryMonth.trim() || undefined,
        expiryYear: expiryYear.trim() || undefined,
        cvv: cvv.trim() || undefined,
        nameOnCard: nameOnCard.trim() || undefined,
      };
    }

    const ok = await run(
      async () => {
        await updateCard({
          id: card.id,
          holderId,
          displayName: cleanDisplayName,
          lastDigits: cleanDigits,
          trackingFrom: trackingFrom || undefined,
          active,
          automationEnabled,
          inactiveFrom: active ? null : (inactiveFrom || undefined),
          paymentDetails,
        });

        const initialAccountId = linkedAccountIds[0] ?? '';
        if (editPortalAccountId !== initialAccountId) {
          const nextAccountIds = editPortalAccountId ? [editPortalAccountId] : [];
          await setCardPortalAccountsAction({
            cardId: card.id,
            portalAccountIds: nextAccountIds,
          });
          setLocalMappings((prev) => [
            ...prev.filter((m) => m.cardId !== card.id),
            ...(editPortalAccountId
              ? [{ id: crypto.randomUUID(), cardId: card.id, portalAccountId: editPortalAccountId }]
              : []),
          ]);
        }
      },
      'Could not save card. Check the card details and try again.',
    );
    if (ok) {
      setFeedback('Card details updated successfully.');
      setMode('view');
    }
  }

  async function handleToggleAutomation(enable: boolean) {
    setError(null);
    const ok = await run(
      () => toggleCardAutomationAction({ cardId: card.id, enabled: enable }),
      `Failed to ${enable ? 'resume' : 'pause'} automation for this card`,
    );
    if (ok) {
      setAutomationEnabled(enable);
    }
  }

  async function handleDelete() {
    const ok = await run(
      () => deleteCard({ id: card.id }),
      'Could not delete card. A card that has benefits in statuses other than Not Ordered cannot be deleted; mark it inactive instead.',
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
                    {card.automationEnabled === false && (
                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-normal text-xs leading-none flex items-center gap-1">
                        <Pause className="h-2.5 w-2.5" />
                        Automation Paused
                      </Badge>
                    )}
                    {card.paymentDetailsCorrupted && (
                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-normal text-xs leading-none flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Payment details need re-entry
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
                    {linkedAccounts.length > 0 && (
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        <KeyRound className="h-3 w-3 text-primary/70" aria-hidden />
                        {linkedAccounts.map((a) => a.label).join(', ')}
                      </span>
                    )}
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

                {/* Payment Checkout Details Section */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Payment Checkout Details
                    </h4>
                    <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                      AES-256-GCM
                    </Badge>
                  </div>
                  {card.paymentSummary ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                        <span className="text-muted-foreground">Card Number</span>
                        <span className="font-mono font-medium text-foreground">
                          {card.paymentSummary.maskedCardNumber || `•••• •••• •••• ${card.lastDigits || '••••'}`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                        <span className="text-muted-foreground">Expiry</span>
                        <span className="font-mono font-medium text-foreground">
                          {card.paymentSummary.expirySummary || '••/••'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                        <span className="text-muted-foreground">CVV</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {card.paymentSummary.hasCvv ? 'Saved & Encrypted ✓' : 'Not set'}
                        </span>
                      </div>
                      {card.paymentSummary.nameOnCard && (
                        <div className="flex items-center justify-between gap-2 py-1">
                          <span className="text-muted-foreground">Name on Card</span>
                          <span className="font-medium text-foreground">{card.paymentSummary.nameOnCard}</span>
                        </div>
                      )}
                    </div>
                  ) : card.paymentDetailsCorrupted ? (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Payment details corrupted — re-enter required
                      </p>
                      <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                        Encrypted credentials exist but cannot be decrypted with the current key (likely saved under a different environment&apos;s key). Edit this card and re-enter card number, expiry and CVV to fix automated ordering.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/80 p-3 text-center">
                      <p className="text-xs text-muted-foreground">
                        No checkout credentials saved. Edit this card to configure full card number and CVV for automated ordering.
                      </p>
                    </div>
                  )}
                </div>

                {/* Feedback Alerts */}
                {feedback && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>{feedback}</span>
                  </div>
                )}

                {/* RuPay Portal Account Mapping Section */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-primary" /> RuPay Portal Account
                    </h4>
                    {linkedAccounts.length > 0 && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-medium py-0 px-1.5">
                        Linked ({linkedAccounts.length})
                      </Badge>
                    )}
                  </div>

                  {accounts.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/80 p-3 text-center space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        No RuPay portal accounts configured in this workspace yet.
                      </p>
                      <Button variant="link" size="sm" asChild className="h-auto p-0 text-xs">
                        <Link href="/accounts">Go to RuPay Accounts →</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {!hasValidPaymentDetails && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 flex items-start justify-between gap-2 text-xs">
                          <div className="space-y-0.5 min-w-0">
                            <p className="text-amber-800 dark:text-amber-300 font-medium flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              Payment details not configured
                            </p>
                            <p className="text-muted-foreground text-[11px] leading-relaxed">
                              You can link this card to RuPay accounts now. Configure full card details (16-digit card number, expiry, CVV) in Edit mode when ready for automated ordering sweeps.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditPortalAccountId(linkedAccountIds[0] ?? '');
                              setMode('edit');
                            }}
                            className="h-6 px-2 text-[11px] font-medium shrink-0 border-amber-500/40 text-amber-900 dark:text-amber-200 hover:bg-amber-500/20"
                          >
                            Edit
                          </Button>
                        </div>
                      )}

                      {/* List of currently linked accounts */}
                      {linkedAccounts.length > 0 ? (
                        <div className="space-y-2">
                          {linkedAccounts.map((acc) => (
                            <div
                              key={acc.id}
                              className="flex items-center justify-between gap-2.5 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs"
                            >
                              <div className="min-w-0 space-y-0.5">
                                <div className="font-semibold text-foreground truncate flex items-center gap-1.5">
                                  <span>{acc.label}</span>
                                  {!acc.active && (
                                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-muted-foreground/30 text-muted-foreground">
                                      Inactive
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {acc.phoneNumber ? `Mobile: ${acc.phoneNumber}` : 'No phone linked'}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => void handleUnlinkAccount(acc.id, acc.label)}
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                                title="Unlink card from this account"
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                Unlink
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          This card is not yet linked to any RuPay portal account.
                        </p>
                      )}

                      {/* Link account selector when there are active unlinked accounts */}
                      {activeUnlinkedAccounts.length > 0 && (
                        <div className="pt-2 border-t border-border/40 space-y-2">
                          <Label htmlFor="link-portal-account-select" className="text-[11px] font-medium text-muted-foreground">
                            {linkedAccounts.length > 0 ? 'Link to an additional RuPay account:' : 'Link to RuPay portal account:'}
                          </Label>
                          <div className="flex items-center gap-2">
                            <select
                              id="link-portal-account-select"
                              disabled={pending || !hasValidPaymentDetails}
                              value={selectedAccountIdToLink}
                              onChange={(e) => setSelectedAccountIdToLink(e.target.value)}
                              className="flex h-8 flex-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <option value="">
                                {hasValidPaymentDetails ? '— Select RuPay Account —' : '— Payment details required to link —'}
                              </option>
                              {activeUnlinkedAccounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.label} {a.phoneNumber ? `(${a.phoneNumber})` : ''}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              size="sm"
                              disabled={pending || !hasValidPaymentDetails || !selectedAccountIdToLink}
                              onClick={() => void handleLinkAccount()}
                              className="h-8 text-xs font-semibold shrink-0 cursor-pointer"
                            >
                              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Link'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Automated Ordering Control */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Bot className="h-3.5 w-3.5 text-primary" /> Automated Ordering
                        </h4>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] py-0 px-1.5 font-medium',
                            automationEnabled
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                          )}
                        >
                          {automationEnabled ? 'Active' : 'Paused'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {automationEnabled
                          ? 'This card is included in automated voucher sweeps.'
                          : 'Excluded from automated sweeps. Manual tracking continues normally.'}
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => handleToggleAutomation(!automationEnabled)}
                      className="h-8 px-3 text-xs font-medium rounded-xl shrink-0"
                    >
                      {automationEnabled ? (
                        <>
                          <Pause className="h-3.5 w-3.5 mr-1 text-amber-600 dark:text-amber-400" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5 mr-1 text-emerald-600 dark:text-emerald-400" />
                          Resume
                        </>
                      )}
                    </Button>
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
                <Button
                  type="button"
                  className="gap-1.5"
                  onClick={() => {
                    setEditPortalAccountId(linkedAccountIds[0] ?? '');
                    setMode('edit');
                  }}
                >
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

                <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      Full Card Details (Optional, for Automation)
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">AES-256-GCM Encrypted</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Stored securely for automated RuPay voucher checkout. Never exposed in plain text.
                  </p>

                  <div className="space-y-2.5 pt-1">
                    <div className="space-y-1">
                      <Label htmlFor="edit-full-card-number" className="text-[11px]">16-Digit Card Number</Label>
                      <Input
                        id="edit-full-card-number"
                        placeholder="•••• •••• •••• ••••"
                        maxLength={19}
                        className="h-8 text-xs font-mono"
                        value={cardNumber}
                        onChange={(e) => handleCardNumberChange(e.target.value)}
                      />
                      {card.paymentSummary?.maskedCardNumber && !cardNumber && (
                        <p className="text-[10px] text-muted-foreground">
                          Current: {card.paymentSummary.maskedCardNumber} (leave blank to keep unchanged)
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="edit-card-exp-month" className="text-[11px]">Exp Month</Label>
                        <Input
                          id="edit-card-exp-month"
                          placeholder={card.paymentSummary?.expirySummary ? card.paymentSummary.expirySummary.split('/')[0] : 'MM'}
                          maxLength={2}
                          className="h-8 text-xs font-mono"
                          value={expiryMonth}
                          onChange={(e) => setExpiryMonth(e.target.value.replace(/\D/g, ''))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-card-exp-year" className="text-[11px]">Exp Year</Label>
                        <Input
                          id="edit-card-exp-year"
                          placeholder={card.paymentSummary?.expirySummary ? `20${card.paymentSummary.expirySummary.split('/')[1]}` : 'YYYY'}
                          maxLength={4}
                          className="h-8 text-xs font-mono"
                          value={expiryYear}
                          onChange={(e) => setExpiryYear(e.target.value.replace(/\D/g, ''))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-card-cvv" className="text-[11px]">CVV</Label>
                        <Input
                          id="edit-card-cvv"
                          placeholder={card.paymentSummary?.hasCvv ? '•••' : 'CVV'}
                          type="password"
                          maxLength={4}
                          className="h-8 text-xs font-mono"
                          value={cvv}
                          onChange={(e) => setCvv(e.target.value.replace(/\D/g, ''))}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="edit-card-name-on-card" className="text-[11px]">Name on Card</Label>
                      <Input
                        id="edit-card-name-on-card"
                        placeholder="As printed on card"
                        className="h-8 text-xs"
                        value={nameOnCard}
                        onChange={(e) => setNameOnCard(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <Field
                  id="edit-card-portal-account"
                  label="RuPay Portal Account (Optional, for Automation)"
                  hint={
                    hasValidPaymentDetails || (cardNumber.replace(/\s+/g, '').length >= 15 && expiryMonth.trim() && expiryYear.trim() && cvv.trim().length >= 3)
                      ? "Assign this card to a RuPay portal account for automated ordering sweeps."
                      : "Enter full card details (number, expiry, CVV) above before assigning to a RuPay account."
                  }
                >
                  <select
                    id="edit-card-portal-account"
                    disabled={!hasValidPaymentDetails && !(cardNumber.replace(/\s+/g, '').length >= 15 && expiryMonth.trim() && expiryYear.trim() && cvv.trim().length >= 3)}
                    value={editPortalAccountId}
                    onChange={(e) => setEditPortalAccountId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">— None (Unassigned) —</option>
                    {accounts
                      .filter((a) => a.active || a.id === editPortalAccountId)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label} {a.phoneNumber ? `(${a.phoneNumber})` : ''} {!a.active ? '(Inactive)' : ''}
                        </option>
                      ))}
                  </select>
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

                  <div className="flex flex-col gap-1.5 pt-2 border-t border-border/40">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={automationEnabled}
                        onChange={(e) => setAutomationEnabled(e.target.checked)}
                        aria-describedby="card-auto-hint"
                      />
                      Include in Automated Ordering
                    </label>
                    <p id="card-auto-hint" className="text-xs text-muted-foreground">
                      Uncheck to pause automated ordering for this card without retiring the card.
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
                  This permanently removes the card and any un-ordered benefits. A card that has benefits in any status other than Not Ordered cannot be deleted; mark it inactive instead.
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
