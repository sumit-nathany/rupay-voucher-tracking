'use client';

import { useState, useEffect } from 'react';
import { Plus, CreditCard, Trash2, ShieldCheck, Lock, Edit2, X, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { PortalAccountView, PortalCardMappingView } from '@/domain/automation';
import { savePortalCardMappingAction, deletePortalCardMappingAction } from '@/actions/automation';

export interface CardOption {
  id: string;
  name: string;
  holderName: string;
  lastDigits: string | null;
}

export function PortalCardMappingsSection({
  mappings,
  accounts,
  availableCards,
}: {
  mappings: PortalCardMappingView[];
  accounts: PortalAccountView[];
  availableCards: CardOption[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<PortalCardMappingView | null>(null);
  const [presetCardId, setPresetCardId] = useState<string | undefined>(undefined);
  const [viewMode, setViewMode] = useState<'by_card' | 'by_mapping'>('by_card');

  function handleOpenAdd() {
    setEditingMapping(null);
    setPresetCardId(undefined);
    setDialogOpen(true);
  }

  function handleOpenAddForCard(cardId: string) {
    setEditingMapping(null);
    setPresetCardId(cardId);
    setDialogOpen(true);
  }

  function handleOpenEdit(m: PortalCardMappingView) {
    setEditingMapping(m);
    setPresetCardId(m.cardId);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">RuPay Card Assignments</h2>
            <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/60 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('by_card')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
                  viewMode === 'by_card'
                    ? 'bg-background shadow-xs text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <CreditCard className="h-3.5 w-3.5" />
                Central Card List ({availableCards.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('by_mapping')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
                  viewMode === 'by_mapping'
                    ? 'bg-background shadow-xs text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                All Mappings ({mappings.length})
              </button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Maintain your RuPay cards centrally, configure payment checkout details once, and assign each card to one or more RuPay portal accounts.
          </p>
        </div>
        <Button
          disabled={accounts.length === 0 || availableCards.length === 0}
          onClick={handleOpenAdd}
          className="gap-2 text-sm font-medium h-10 px-4 rounded-xl self-start sm:self-auto shrink-0"
        >
          <Plus className="h-4 w-4" />
          Assign Card
        </Button>
      </div>

      {viewMode === 'by_card' ? (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs mt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Tracker RuPay Card</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Assigned Portal Accounts</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Payment Details (Shared)</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {availableCards.map((card) => {
                  const cardMappings = mappings.filter((m) => m.cardId === card.id);
                  const sharedPayment = cardMappings.find((m) => m.paymentDetails)?.paymentDetails;

                  return (
                    <tr key={card.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-4 sm:py-5 px-5 sm:px-6">
                        <div className="font-semibold text-sm sm:text-base text-foreground">{card.name}</div>
                        <div className="text-xs sm:text-sm text-muted-foreground mt-1">
                          {card.holderName} {card.lastDigits ? `(••${card.lastDigits})` : ''}
                        </div>
                      </td>

                      <td className="py-4 sm:py-5 px-5 sm:px-6">
                        {cardMappings.length === 0 ? (
                          <span className="text-xs sm:text-sm text-muted-foreground italic">
                            Not assigned to any account
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {cardMappings.map((m) => {
                              const acc = accounts.find((a) => a.id === m.portalAccountId);
                              return (
                                <Badge
                                  key={m.id}
                                  variant="secondary"
                                  className="gap-1.5 text-xs py-1 px-2.5 font-medium border border-border/60"
                                >
                                  <span>{acc?.label ?? 'Account'}</span>
                                  <UnmapMiniButton id={m.id} cardName={card.name} />
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      <td className="py-4 sm:py-5 px-5 sm:px-6">
                        {sharedPayment ? (
                          <Badge
                            variant="outline"
                            className="gap-1.5 font-mono text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 py-1 px-2.5 font-medium"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {sharedPayment.mode === 'full'
                              ? `${sharedPayment.maskedCardNumber || 'Full Card'} · Exp ${sharedPayment.expirySummary || '••/••'} · CVV ✓`
                              : 'Saved Card · CVV ✓'}
                          </Badge>
                        ) : (
                          <span className="text-xs sm:text-sm text-muted-foreground italic">
                            No payment details set
                          </span>
                        )}
                      </td>

                      <td className="py-4 sm:py-5 px-5 sm:px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenAddForCard(card.id)}
                            className="h-8 gap-1 text-xs rounded-lg"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Assign
                          </Button>
                          {cardMappings.length > 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenEdit(cardMappings[0])}
                              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                              title="Edit payment details / mapping"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs mt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Tracker Card</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Portal Account</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Payment Gateway Details</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {mappings.map((m) => {
                  const acc = accounts.find((a) => a.id === m.portalAccountId);
                  return (
                    <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-4 sm:py-5 px-5 sm:px-6">
                        <div className="font-semibold text-sm sm:text-base text-foreground">{m.cardName}</div>
                        <div className="text-xs sm:text-sm text-muted-foreground mt-1">
                          {m.holderName} {m.last4 ? `(••${m.last4})` : ''}
                        </div>
                      </td>
                      <td className="py-4 sm:py-5 px-5 sm:px-6 font-medium text-sm sm:text-base text-foreground">
                        {acc?.label ?? 'Unknown Account'}
                      </td>
                      <td className="py-4 sm:py-5 px-5 sm:px-6">
                        {m.paymentDetails ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant="outline"
                              className="gap-1.5 font-mono text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 py-1 px-2.5 font-medium"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              {m.paymentDetails.mode === 'full'
                                ? `${m.paymentDetails.maskedCardNumber || 'Full Card'} · Exp ${m.paymentDetails.expirySummary || '••/••'} · CVV ✓`
                                : 'Saved Card · CVV ✓'}
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-xs sm:text-sm text-muted-foreground italic">
                            No payment details set
                          </span>
                        )}
                      </td>
                      <td className="py-4 sm:py-5 px-5 sm:px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(m)}
                            className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground"
                            title="Edit payment details / mapping"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <DeleteMappingButton id={m.id} cardName={m.cardName} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MappingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        accounts={accounts}
        cards={availableCards}
        existing={editingMapping}
        defaultCardId={presetCardId}
        mappings={mappings}
      />
    </div>
  );
}

function UnmapMiniButton({ id, cardName }: { id: string; cardName: string }) {
  const [busy, setBusy] = useState(false);

  async function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Unassign "${cardName}" from this account?`)) return;
    setBusy(true);
    try {
      await deletePortalCardMappingAction({ id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => void handleRemove(e)}
      className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
      title="Unassign from this account"
    >
      <X className="h-3 w-3" />
    </button>
  );
}

function DeleteMappingButton({ id, cardName }: { id: string; cardName: string }) {
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm(`Remove portal mapping for "${cardName}"?`)) return;
    setBusy(true);
    try {
      await deletePortalCardMappingAction({ id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={busy}
      onClick={() => void handleDelete()}
      className="h-7 w-7 text-muted-foreground hover:text-destructive"
      title="Delete mapping"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export function MappingDialog({
  open,
  onOpenChange,
  accounts,
  cards,
  existing,
  defaultAccountId,
  defaultCardId,
  mappings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: PortalAccountView[];
  cards: CardOption[];
  existing: PortalCardMappingView | null;
  defaultAccountId?: string;
  defaultCardId?: string;
  mappings?: PortalCardMappingView[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>(
    existing?.portalAccountId ?? defaultAccountId ?? accounts[0]?.id ?? '',
  );
  const [selectedCard, setSelectedCard] = useState<string>(
    existing?.cardId ?? defaultCardId ?? cards[0]?.id ?? '',
  );

  // Payment details mode: 'full' | 'saved_card' | 'none'
  const [paymentMode, setPaymentMode] = useState<'full' | 'saved_card' | 'none'>(
    existing?.paymentDetails?.mode ?? 'none',
  );

  useEffect(() => {
    if (open) {
      const activeCardId = existing?.cardId ?? defaultCardId ?? cards[0]?.id ?? '';
      setSelectedAccount(existing?.portalAccountId ?? defaultAccountId ?? accounts[0]?.id ?? '');
      setSelectedCard(activeCardId);
      const sharedDetails = existing?.paymentDetails ?? mappings?.find((m) => m.cardId === activeCardId && m.paymentDetails)?.paymentDetails;
      setPaymentMode(sharedDetails?.mode ?? 'none');
      setError(null);
    }
  }, [open, existing, defaultAccountId, defaultCardId, accounts, cards, mappings]);

  // Check if current card already has shared details
  const cardMappings = mappings?.filter((m) => m.cardId === selectedCard) ?? [];
  const existingSharedPayment = existing?.paymentDetails ?? cardMappings.find((m) => m.paymentDetails)?.paymentDetails;
  const isAlreadyMappedToSelectedAccount = cardMappings.some((m) => m.portalAccountId === selectedAccount);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    if (!selectedAccount || !selectedCard) {
      setError('Please select an account and card');
      return;
    }

    let paymentDetails = null;
    if (paymentMode === 'full') {
      const cardNumber = String(fd.get('cardNumber') ?? '').replace(/\s+/g, '');
      const expiryMonth = String(fd.get('expiryMonth') ?? '').trim();
      const expiryYear = String(fd.get('expiryYear') ?? '').trim();
      const cvv = String(fd.get('cvv') ?? '').trim();
      const nameOnCard = String(fd.get('nameOnCard') ?? '').trim();

      if (cardNumber && cardNumber.length !== 16) {
        setError('Card number must be 16 digits');
        return;
      }

      paymentDetails = {
        version: 1 as const,
        mode: 'full' as const,
        cardNumber: cardNumber || undefined,
        expiryMonth: expiryMonth || undefined,
        expiryYear: expiryYear || undefined,
        cvv: cvv || undefined,
        nameOnCard: nameOnCard || undefined,
      };
    } else if (paymentMode === 'saved_card') {
      const cvv = String(fd.get('savedCvv') ?? '').trim();
      paymentDetails = {
        version: 1 as const,
        mode: 'saved_card' as const,
        cvv: cvv || undefined,
      };
    } else if (existingSharedPayment) {
      // Re-use existing shared payment details without modification
      paymentDetails = undefined;
    }

    setBusy(true);
    setError(null);
    try {
      await savePortalCardMappingAction({
        id: existing?.id,
        portalAccountId: selectedAccount,
        cardId: selectedCard,
        paymentDetails,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit Card Assignment' : 'Assign RuPay Card to Portal Account'}</DialogTitle>
          <DialogDescription>
            The same RuPay card can be assigned to multiple accounts. Its payment gateway credentials are automatically shared across accounts.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Tracker RuPay Card</Label>
            <Select value={selectedCard} onValueChange={(val) => {
              setSelectedCard(val);
              const shared = mappings?.find((m) => m.cardId === val && m.paymentDetails)?.paymentDetails;
              if (shared) setPaymentMode(shared.mode);
            }}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select card" />
              </SelectTrigger>
              <SelectContent>
                {cards.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.holderName} {c.lastDigits ? `••${c.lastDigits}` : ''})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {cardMappings.length > 0 && (
              <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                <span>Already assigned to:</span>
                <span className="font-medium text-foreground">
                  {cardMappings.map((cm) => accounts.find((a) => a.id === cm.portalAccountId)?.label ?? 'Account').join(', ')}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Assign to RuPay Portal Account</Label>
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select portal account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => {
                  const already = cardMappings.some((cm) => cm.portalAccountId === a.id);
                  return (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label} {already ? '(Assigned)' : ''}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {isAlreadyMappedToSelectedAccount && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                This card is already assigned to this account. Saving will update its configuration.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Payment Gateway Checkout Details
              </div>
              <span className="text-[10px] text-muted-foreground">AES-256-GCM Encrypted</span>
            </div>

            {existingSharedPayment && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Card details already configured ({existingSharedPayment.mode === 'full' ? 'Full Card' : 'Saved Card · CVV ✓'}). Reused automatically across assigned accounts.
                </span>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              When ordering benefits requiring nominal auth or charges, browser automation fills in card details on the gateway.
            </p>

            <div className="grid grid-cols-3 gap-1.5 bg-muted/50 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setPaymentMode('full')}
                className={`py-1.5 px-2 rounded-md font-medium text-center transition-all ${
                  paymentMode === 'full'
                    ? 'bg-background shadow-xs text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Full Card (A)
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode('saved_card')}
                className={`py-1.5 px-2 rounded-md font-medium text-center transition-all ${
                  paymentMode === 'saved_card'
                    ? 'bg-background shadow-xs text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Saved Card (B)
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode('none')}
                className={`py-1.5 px-2 rounded-md font-medium text-center transition-all ${
                  paymentMode === 'none'
                    ? 'bg-background shadow-xs text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                None
              </button>
            </div>

            {paymentMode === 'full' && (
              <div className="space-y-2.5 pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px]">16-Digit Card Number</Label>
                  <Input
                    name="cardNumber"
                    placeholder="•••• •••• •••• ••••"
                    maxLength={19}
                    className="h-8 text-xs font-mono"
                    defaultValue={existing?.paymentDetails?.maskedCardNumber ? '' : undefined}
                  />
                  {existingSharedPayment?.maskedCardNumber && (
                    <p className="text-[10px] text-muted-foreground">
                      Current: {existingSharedPayment.maskedCardNumber} (leave blank to keep unchanged)
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Exp Month</Label>
                    <Input name="expiryMonth" placeholder="MM" maxLength={2} className="h-8 text-xs font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Exp Year</Label>
                    <Input name="expiryYear" placeholder="YYYY" maxLength={4} className="h-8 text-xs font-mono" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">CVV</Label>
                    <Input name="cvv" placeholder="•••" type="password" maxLength={4} className="h-8 text-xs font-mono" />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px]">Name on Card</Label>
                  <Input name="nameOnCard" placeholder="As printed on card" className="h-8 text-xs" />
                </div>
              </div>
            )}

            {paymentMode === 'saved_card' && (
              <div className="space-y-2 pt-1">
                <div className="space-y-1">
                  <Label className="text-[11px]">CVV / Security Code</Label>
                  <Input
                    name="savedCvv"
                    placeholder="•••"
                    type="password"
                    maxLength={4}
                    className="h-8 text-xs font-mono w-28"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Assumes card is pre-saved on the merchant gateway (Juspay / Truztee). Only CVV will be entered.
                  </p>
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-destructive font-medium">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Saving...' : existing ? 'Update Assignment' : 'Assign to Account'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
