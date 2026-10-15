'use client';

import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { PortalAccountView, PortalCardMappingView } from '@/domain/automation';
import { setCardPortalAccountsAction } from '@/actions/automation';

export interface CardOption {
  id: string;
  name: string;
  holderName: string;
  lastDigits: string | null;
  hasPaymentDetails?: boolean;
}

export interface AssignAccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: CardOption[];
  accounts: PortalAccountView[];
  mappings: PortalCardMappingView[];
  defaultCardId?: string;
  defaultAccountId?: string;
  existing?: PortalCardMappingView | null;
}

export function AssignAccountsDialog({
  open,
  onOpenChange,
  cards,
  accounts,
  mappings,
  defaultCardId,
  defaultAccountId,
  existing,
}: AssignAccountsDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<string>(existing?.cardId ?? defaultCardId ?? cards[0]?.id ?? '');
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

  // Initialize or update selected accounts when card selection changes or dialog opens
  useEffect(() => {
    if (open) {
      const readyCardId = cards.find((c) => c.hasPaymentDetails)?.id ?? cards[0]?.id ?? '';
      const activeCardId = existing?.cardId ?? defaultCardId ?? readyCardId;
      setSelectedCard(activeCardId);
      const mappedAccountIds = new Set(
        mappings
          .filter((m) => m.cardId === activeCardId)
          .map((m) => m.portalAccountId),
      );
      if (defaultAccountId) {
        mappedAccountIds.add(defaultAccountId);
      }
      setSelectedAccounts(mappedAccountIds);
      setError(null);
    }
  }, [open, existing, defaultCardId, defaultAccountId, cards, mappings]);

  function handleCardChange(cardId: string) {
    setSelectedCard(cardId);
    const mappedAccountIds = mappings
      .filter((m) => m.cardId === cardId)
      .map((m) => m.portalAccountId);
    setSelectedAccounts(new Set(mappedAccountIds));
  }

  function toggleAccount(accountId: string) {
    const next = new Set(selectedAccounts);
    if (next.has(accountId)) {
      next.delete(accountId);
    } else {
      next.add(accountId);
    }
    setSelectedAccounts(next);
  }

  function handleSelectAll() {
    setSelectedAccounts(new Set(accounts.map((a) => a.id)));
  }

  function handleDeselectAll() {
    setSelectedAccounts(new Set());
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedCard) {
      setError('Please select a card');
      return;
    }

    const cardObj = cards.find((c) => c.id === selectedCard);
    if (selectedAccounts.size > 0 && !cardObj?.hasPaymentDetails) {
      setError(
        'Cannot assign card: Payment details (card number, expiry date, CVV) must be configured on the card before assigning it to a portal account. Please add payment details under Cards.',
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await setCardPortalAccountsAction({
        cardId: selectedCard,
        portalAccountIds: Array.from(selectedAccounts),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account assignments');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign RuPay Card to Accounts</DialogTitle>
          <DialogDescription>
            Select the RuPay portal accounts this card should be mapped to.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Tracker RuPay Card</Label>
            <Select value={selectedCard} onValueChange={handleCardChange}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select card" />
              </SelectTrigger>
              <SelectContent>
                {cards.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={!c.hasPaymentDetails}>
                    {c.name} ({c.holderName} {c.lastDigits ? `••${c.lastDigits}` : ''})
                    {!c.hasPaymentDetails ? ' — (Missing details: configure in Cards)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(() => {
            const currentCard = cards.find((c) => c.id === selectedCard);
            if (currentCard && !currentCard.hasPaymentDetails) {
              return (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                  <div className="font-semibold text-amber-800 dark:text-amber-300">
                    ⚠️ Payment details missing
                  </div>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    This card does not have payment details (card number, expiry date, CVV) configured. Automation cannot checkout without payment details. Please configure payment details on this card in the Cards section before assigning it to a portal account.
                  </p>
                </div>
              );
            }
            return null;
          })()}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">
                RuPay Accounts ({selectedAccounts.size} of {accounts.length} selected)
              </Label>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-primary hover:underline font-medium text-[11px]"
                >
                  Select all
                </button>
                <span className="text-muted-foreground/40">|</span>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="text-muted-foreground hover:text-foreground font-medium text-[11px]"
                >
                  Deselect all
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 divide-y divide-border/40 max-h-60 overflow-y-auto bg-muted/10 p-1">
              {accounts.map((a) => {
                const isSelected = selectedAccounts.has(a.id);
                return (
                  <div
                    key={a.id}
                    onClick={() => toggleAccount(a.id)}
                    className={`flex items-center justify-between p-2.5 rounded-lg text-sm cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-primary/5 dark:bg-primary/10 text-foreground font-medium'
                        : 'hover:bg-muted/40 text-muted-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/40 bg-background'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                      </div>
                      <div>
                        <div className={`text-xs sm:text-sm ${isSelected ? 'text-foreground' : 'text-foreground/80'}`}>
                          {a.label}
                        </div>
                        {a.phoneNumber && (
                          <div className="text-[11px] text-muted-foreground">{a.phoneNumber}</div>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={isSelected ? 'default' : 'secondary'}
                      className="text-[10px] px-1.5 py-0 font-normal"
                    >
                      {isSelected ? 'Mapped' : 'Unmapped'}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p className="text-xs text-destructive font-medium">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                busy ||
                Boolean(
                  cards.find((c) => c.id === selectedCard) &&
                    !cards.find((c) => c.id === selectedCard)?.hasPaymentDetails &&
                    selectedAccounts.size > 0,
                )
              }
            >
              {busy ? 'Saving...' : 'Save Assignments'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { AssignAccountsDialog as MappingDialog };
