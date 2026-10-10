'use client';

import { useState } from 'react';
import { Plus, CreditCard, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">Card to Portal Mappings</h2>
          <p className="text-xs text-muted-foreground">
            Connect tracked cards in your workspace to their registered RuPay portal card product identifiers.
          </p>
        </div>
        <Button
          size="sm"
          disabled={accounts.length === 0 || availableCards.length === 0}
          onClick={() => setAddOpen(true)}
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
            Map your RuPay cards to a portal account so the automated worker knows which account and portal card ID to use.
          </p>
          {accounts.length > 0 && availableCards.length > 0 && (
            <Button size="sm" onClick={() => setAddOpen(true)} className="mt-4 h-8 text-xs font-semibold">
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
                  <th className="py-2.5 px-4">Portal Card ID</th>
                  <th className="py-2.5 px-4">Card BIN ID</th>
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
                      <td className="py-3 px-4 font-mono font-medium text-foreground">
                        {m.portalCardId}
                      </td>
                      <td className="py-3 px-4 font-mono text-muted-foreground">
                        {m.portalCardbinId ?? '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <DeleteMappingButton id={m.id} cardName={m.cardName} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddMappingDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={accounts}
        cards={availableCards}
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

function AddMappingDialog({
  open,
  onOpenChange,
  accounts,
  cards,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: PortalAccountView[];
  cards: CardOption[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>(accounts[0]?.id ?? '');
  const [selectedCard, setSelectedCard] = useState<string>(cards[0]?.id ?? '');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const portalCardId = String(fd.get('portalCardId') ?? '').trim();
    const portalCardbinId = String(fd.get('portalCardbinId') ?? '').trim();

    if (!selectedAccount || !selectedCard || !portalCardId) {
      setError('Please select an account, card, and provide portal card ID');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await savePortalCardMappingAction({
        portalAccountId: selectedAccount,
        cardId: selectedCard,
        portalCardId,
        portalCardbinId: portalCardbinId || null,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Map Tracker Card to RuPay Portal</DialogTitle>
          <DialogDescription>
            Associate a physical card in your workspace with its RuPay portal registration identifiers.
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="portalCardId" className="text-xs font-semibold">
                Portal Card ID
              </Label>
              <Input
                id="portalCardId"
                name="portalCardId"
                placeholder="e.g. 151"
                required
                className="h-9 text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground">From card catalog / portal endpoint</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="portalCardbinId" className="text-xs font-semibold">
                Portal Card BIN ID (optional)
              </Label>
              <Input
                id="portalCardbinId"
                name="portalCardbinId"
                placeholder="e.g. 208"
                className="h-9 text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground">Required for Select cards</p>
            </div>
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
