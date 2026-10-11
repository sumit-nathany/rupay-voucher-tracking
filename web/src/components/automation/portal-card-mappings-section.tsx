'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Check, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { PortalAccountView, PortalCardMappingView } from '@/domain/automation';
import { setCardPortalAccountsAction, deletePortalCardMappingAction } from '@/actions/automation';

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
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>(undefined);

  function handleOpenAssign(cardId?: string) {
    setSelectedCardId(cardId ?? availableCards[0]?.id);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
            RuPay Card Assignments
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Central list of your RuPay cards and the connected RuPay portal accounts they are assigned to.
          </p>
        </div>
        <Button
          disabled={accounts.length === 0 || availableCards.length === 0}
          onClick={() => handleOpenAssign()}
          className="gap-2 text-sm font-medium h-10 px-4 rounded-xl self-start sm:self-auto shrink-0"
        >
          <Plus className="h-4 w-4" />
          Assign Accounts
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <tr>
                <th className="py-3.5 sm:py-4 px-5 sm:px-6">Tracker RuPay Card</th>
                <th className="py-3.5 sm:py-4 px-5 sm:px-6">Assigned RuPay Accounts</th>
                <th className="py-3.5 sm:py-4 px-5 sm:px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {availableCards.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 px-6 text-center text-sm text-muted-foreground">
                    No RuPay cards found in workspace. Add cards in the Cards section first.
                  </td>
                </tr>
              ) : (
                availableCards.map((card) => {
                  const cardMappings = mappings.filter((m) => m.cardId === card.id);

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

                      <td className="py-4 sm:py-5 px-5 sm:px-6 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenAssign(card.id)}
                          className="h-8 gap-1.5 text-xs rounded-lg font-medium"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          Assign Accounts
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AssignAccountsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cards={availableCards}
        accounts={accounts}
        mappings={mappings}
        defaultCardId={selectedCardId}
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
      const activeCardId = existing?.cardId ?? defaultCardId ?? cards[0]?.id ?? '';
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
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.holderName} {c.lastDigits ? `••${c.lastDigits}` : ''})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Saving...' : 'Save Assignments'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { AssignAccountsDialog as MappingDialog };
