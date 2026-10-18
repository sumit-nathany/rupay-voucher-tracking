'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, AlertTriangle, ShieldCheck, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { PortalAccountView, PortalCardMappingView } from '@/domain/automation';
import { setPortalAccountCardsAction } from '@/actions/automation';

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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());

  // Initialize or update selected account and card selections when dialog opens or defaults change
  useEffect(() => {
    if (open) {
      const activeAccountId =
        existing?.portalAccountId ??
        defaultAccountId ??
        (defaultCardId
          ? mappings.find((m) => m.cardId === defaultCardId)?.portalAccountId
          : undefined) ??
        accounts[0]?.id ??
        '';

      setSelectedAccount(activeAccountId);

      const mappedCardIds = new Set(
        mappings
          .filter((m) => m.portalAccountId === activeAccountId)
          .map((m) => m.cardId),
      );
      if (existing?.cardId) {
        mappedCardIds.add(existing.cardId);
      }
      if (defaultCardId) {
        mappedCardIds.add(defaultCardId);
      }
      setSelectedCards(mappedCardIds);
      setError(null);
    }
  }, [open, existing, defaultAccountId, defaultCardId, accounts, mappings]);

  function handleAccountChange(accountId: string) {
    setSelectedAccount(accountId);
    const mappedCardIds = mappings
      .filter((m) => m.portalAccountId === accountId)
      .map((m) => m.cardId);
    setSelectedCards(new Set(mappedCardIds));
    setError(null);
  }

  function toggleCard(cardId: string, isEligible: boolean) {
    if (!isEligible) return;
    const next = new Set(selectedCards);
    if (next.has(cardId)) {
      next.delete(cardId);
    } else {
      next.add(cardId);
    }
    setSelectedCards(next);
  }

  function handleSelectAllEligible() {
    const eligibleIds = cards.filter((c) => Boolean(c.hasPaymentDetails)).map((c) => c.id);
    setSelectedCards(new Set(eligibleIds));
  }

  function handleDeselectAll() {
    setSelectedCards(new Set());
  }

  const currentAccount = accounts.find((a) => a.id === selectedAccount);
  const eligibleCount = cards.filter((c) => Boolean(c.hasPaymentDetails)).length;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedAccount) {
      setError('Please select a RuPay portal account');
      return;
    }

    const ineligibleSelected = Array.from(selectedCards).filter(
      (cid) => !cards.find((c) => c.id === cid)?.hasPaymentDetails,
    );
    if (ineligibleSelected.length > 0) {
      setError(
        'Cannot assign cards: Payment details (card number, expiry date, CVV) must be configured on all cards before assigning them to a portal account. Please add payment details under Cards.',
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await setPortalAccountCardsAction({
        portalAccountId: selectedAccount,
        cardIds: Array.from(selectedCards),
      });
      router.refresh();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update card assignments');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Map Cards to RuPay Account</DialogTitle>
          <DialogDescription>
            Select the RuPay portal account and choose which tracker cards to map for automated ordering.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-1">
          {/* RuPay Account Selection at top */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">RuPay Portal Account</Label>
            <Select value={selectedAccount} onValueChange={handleAccountChange}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select portal account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label} {a.phoneNumber ? `(${a.phoneNumber})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Selected Account Summary Card */}
            {currentAccount && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-2.5 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground truncate">{currentAccount.label}</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] capitalize font-medium py-0 px-1.5"
                  >
                    {currentAccount.status.replace('_', ' ')}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                  <span>Registered Mobile: {currentAccount.phoneNumber || 'Not configured'}</span>
                  <span>
                    {mappings.filter((m) => m.portalAccountId === currentAccount.id).length} card(s) mapped
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Cards List Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                Tracker RuPay Cards ({selectedCards.size} of {cards.length} selected)
              </Label>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleSelectAllEligible}
                  className="text-primary hover:underline font-medium text-[11px]"
                  disabled={eligibleCount === 0}
                >
                  Select all eligible
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

            <div className="rounded-xl border border-border/70 divide-y divide-border/40 max-h-64 overflow-y-auto bg-muted/10 p-1">
              {cards.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No RuPay cards found in your workspace. Add cards under Cards first.
                </div>
              ) : (
                cards.map((c) => {
                  const isSelected = selectedCards.has(c.id);
                  const isEligible = Boolean(c.hasPaymentDetails);

                  return (
                    <div
                      key={c.id}
                      onClick={() => toggleCard(c.id, isEligible)}
                      className={`flex items-center justify-between p-2.5 rounded-lg text-sm transition-colors ${
                        !isEligible
                          ? 'opacity-60 cursor-not-allowed bg-muted/20'
                          : isSelected
                          ? 'bg-primary/5 dark:bg-primary/10 text-foreground font-medium cursor-pointer'
                          : 'hover:bg-muted/40 text-muted-foreground cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-2">
                        <div
                          className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                            !isEligible
                              ? 'border-muted-foreground/20 bg-muted/40 text-transparent'
                              : isSelected
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-muted-foreground/40 bg-background'
                          }`}
                        >
                          {isSelected && isEligible && <Check className="h-3 w-3 stroke-[3]" />}
                        </div>
                        <div className="min-w-0">
                          <div className={`text-xs sm:text-sm truncate ${isSelected && isEligible ? 'text-foreground' : 'text-foreground/80'}`}>
                            {c.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 truncate">
                            <span>{c.holderName}</span>
                            {c.lastDigits && <span>••{c.lastDigits}</span>}
                          </div>
                          {!isEligible && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400">
                              Configure payment details in Cards to enable mapping
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5">
                        {isEligible ? (
                          isSelected ? (
                            <Badge className="text-[10px] px-1.5 py-0 font-normal">
                              Mapped
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 font-normal bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 flex items-center gap-0.5"
                            >
                              <ShieldCheck className="h-2.5 w-2.5" />
                              Ready
                            </Badge>
                          )
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 font-normal bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                          >
                            Missing payment details
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Alert if cards lack payment details */}
          {cards.some((c) => !c.hasPaymentDetails) && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-amber-800 dark:text-amber-300">
                  Payment details required for automation
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Automation requires payment details (card number, expiry, CVV) to checkout vouchers. Cards without payment details cannot be mapped to portal accounts.
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive font-medium">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy || !selectedAccount}
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
