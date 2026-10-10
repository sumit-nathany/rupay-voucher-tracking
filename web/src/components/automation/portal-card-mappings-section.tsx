'use client';

import { useState } from 'react';
import { Plus, CreditCard, Trash2, ShieldCheck, Lock, Edit2 } from 'lucide-react';
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

  function handleOpenAdd() {
    setEditingMapping(null);
    setDialogOpen(true);
  }

  function handleOpenEdit(m: PortalCardMappingView) {
    setEditingMapping(m);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">Card to Portal Mappings</h2>
          <p className="text-xs text-muted-foreground">
            Connect cards in your workspace to their RuPay portal login and optional payment gateway checkout details.
          </p>
        </div>
        <Button
          size="sm"
          disabled={accounts.length === 0 || availableCards.length === 0}
          onClick={handleOpenAdd}
          className="h-8 gap-1.5 text-xs font-semibold"
        >
          <Plus className="h-3.5 w-3.5" />
          Map Card
        </Button>
      </div>

      {mappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-8 text-center bg-muted/10">
          <CreditCard className="h-8 w-8 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-semibold text-foreground">No Cards Mapped</p>
          <p className="text-xs text-muted-foreground max-w-sm mt-1">
            Map your RuPay cards to a portal account so browser automation knows which account to log into and which card details to use at checkout.
          </p>
          {accounts.length > 0 && availableCards.length > 0 && (
            <Button size="sm" onClick={handleOpenAdd} className="mt-4 h-8 text-xs font-semibold">
              Map a Card
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="py-2.5 px-4">Tracker Card</th>
                  <th className="py-2.5 px-4">Portal Account</th>
                  <th className="py-2.5 px-4">Payment Gateway Details</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {mappings.map((m) => {
                  const acc = accounts.find((a) => a.id === m.portalAccountId);
                  return (
                    <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-foreground">{m.cardName}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {m.holderName} {m.last4 ? `(••${m.last4})` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-medium text-foreground">
                        {acc?.label ?? 'Unknown Account'}
                      </td>
                      <td className="py-3 px-4">
                        {m.paymentDetails ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant="outline"
                              className="gap-1 font-mono text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              {m.paymentDetails.mode === 'full'
                                ? `${m.paymentDetails.maskedCardNumber || 'Full Card'} · Exp ${m.paymentDetails.expirySummary || '••/••'} · CVV ✓`
                                : 'Saved Card · CVV ✓'}
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">
                            No payment details set
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(m)}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Edit payment details / mapping"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
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
      />
    </div>
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

function MappingDialog({
  open,
  onOpenChange,
  accounts,
  cards,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: PortalAccountView[];
  cards: CardOption[];
  existing: PortalCardMappingView | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>(
    existing?.portalAccountId ?? accounts[0]?.id ?? '',
  );
  const [selectedCard, setSelectedCard] = useState<string>(
    existing?.cardId ?? cards[0]?.id ?? '',
  );

  // Payment details mode: 'full' | 'saved_card' | 'none'
  const [paymentMode, setPaymentMode] = useState<'full' | 'saved_card' | 'none'>(
    existing?.paymentDetails?.mode ?? 'none',
  );

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
          <DialogTitle>{existing ? 'Edit Card Mapping' : 'Map Tracker Card to RuPay Portal'}</DialogTitle>
          <DialogDescription>
            The RuPay portal limits benefits by account and card type. The actual card verification happens on the payment gateway during checkout.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">RuPay Portal Account</Label>
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select portal account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Tracker Card</Label>
            <Select value={selectedCard} onValueChange={setSelectedCard}>
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
          </div>

          <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Payment Gateway Checkout Details
              </div>
              <span className="text-[10px] text-muted-foreground">AES-256-GCM Encrypted</span>
            </div>

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
                  <Label htmlFor="cardNumber" className="text-[11px] font-semibold">
                    16-Digit Card Number
                  </Label>
                  <Input
                    id="cardNumber"
                    name="cardNumber"
                    placeholder="1234 5678 9012 3456"
                    maxLength={19}
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold">Expiry (MM / YY)</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        name="expiryMonth"
                        placeholder="MM"
                        maxLength={2}
                        className="h-8 text-xs font-mono text-center"
                      />
                      <span className="text-muted-foreground">/</span>
                      <Input
                        name="expiryYear"
                        placeholder="YY"
                        maxLength={4}
                        className="h-8 text-xs font-mono text-center"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cvv" className="text-[11px] font-semibold">
                      CVV
                    </Label>
                    <Input
                      id="cvv"
                      name="cvv"
                      placeholder="123"
                      maxLength={4}
                      type="password"
                      className="h-8 text-xs font-mono text-center"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nameOnCard" className="text-[11px] font-semibold">
                    Name on Card (Optional)
                  </Label>
                  <Input
                    id="nameOnCard"
                    name="nameOnCard"
                    placeholder="Full name as printed on card"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}

            {paymentMode === 'saved_card' && (
              <div className="space-y-2.5 pt-1">
                <p className="text-[11px] text-muted-foreground">
                  Card is already saved/tokenized on the gateway. Only CVV is required to authorize the transaction.
                </p>
                <div className="w-24 space-y-1">
                  <Label htmlFor="savedCvv" className="text-[11px] font-semibold">
                    CVV
                  </Label>
                  <Input
                    id="savedCvv"
                    name="savedCvv"
                    placeholder="123"
                    maxLength={4}
                    type="password"
                    className="h-8 text-xs font-mono text-center"
                  />
                </div>
              </div>
            )}

            {paymentMode === 'none' && (
              <p className="text-[11px] text-muted-foreground italic">
                No payment details configured. If payment is required during automated run, the attempt will pause for manual input.
              </p>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="h-8 text-xs font-semibold"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="h-8 text-xs font-semibold">
              Save Mapping
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
