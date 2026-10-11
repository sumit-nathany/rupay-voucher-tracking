'use client';

import { useState } from 'react';
import { Plus, Sliders, Trash2, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { PortalAccountView, OrderingRuleView } from '@/domain/automation';
import {
  createOrderingRuleAction,
  updateOrderingRuleAction,
  deleteOrderingRuleAction,
} from '@/actions/automation';

export interface BenefitOptionItem {
  id: string;
  benefitType: string;
  exactBenefit: string;
  options?: Array<{ id: string; optionName: string }>;
}

export function OrderingRulesSection({
  rules,
  accounts,
}: {
  rules: OrderingRuleView[];
  accounts: PortalAccountView[];
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">Ordering Rules & Priorities</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Rules determine which unclaimed benefit runs first each day. Lower priority numbers run first.
          </p>
        </div>
        <Button
          disabled={accounts.length === 0}
          onClick={() => setAddOpen(true)}
          className="gap-2 text-sm font-medium h-10 px-4 rounded-xl self-start sm:self-auto shrink-0"
        >
          <Plus className="h-4 w-4" />
          Create Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-12 text-center bg-muted/10">
          <Sliders className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-base font-semibold text-foreground">No Ordering Rules Configured</p>
          <p className="text-sm text-muted-foreground max-w-sm mt-1.5">
            Create an ordering rule to nominate benefits for daily automated ordering.
          </p>
          {accounts.length > 0 && (
            <Button onClick={() => setAddOpen(true)} className="mt-6 gap-2 text-sm font-medium h-10 px-4 rounded-xl">
              <Plus className="h-4 w-4" />
              Create Rule
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} accounts={accounts} />
          ))}
        </div>
      )}

      <AddRuleDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={accounts}
      />
    </div>
  );
}

function RuleRow({ rule, accounts }: { rule: OrderingRuleView; accounts: PortalAccountView[] }) {
  const [busy, setBusy] = useState(false);
  const acc = accounts.find((a) => a.id === rule.portalAccountId);

  async function handleToggle() {
    setBusy(true);
    try {
      await updateOrderingRuleAction({ id: rule.id, enabled: !rule.enabled });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    setBusy(true);
    try {
      await deleteOrderingRuleAction({ id: rule.id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge variant="outline" className="text-xs font-semibold px-2.5 py-0.5 bg-primary/10 text-primary border-primary/20 rounded-lg">
            Priority {rule.priority}
          </Badge>
          <h3 className="text-base sm:text-lg font-semibold text-foreground">{rule.name}</h3>
          <Badge variant={rule.enabled ? 'default' : 'secondary'} className="text-xs font-normal">
            {rule.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          Account: <span className="font-medium text-foreground">{acc?.label ?? 'Unknown'}</span> •{' '}
          {rule.cardIds.length === 0 ? 'All mapped cards' : `${rule.cardIds.length} cards`} •{' '}
          {rule.benefitIds.length === 0 ? 'All eligible benefits' : `${rule.benefitIds.length} benefits`}
        </p>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void handleToggle()}
          className="h-9 px-3.5 text-xs sm:text-sm font-medium gap-2 rounded-xl"
        >
          <Power className="h-3.5 w-3.5" />
          {rule.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          onClick={() => void handleDelete()}
          className="h-9 w-9 rounded-xl text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function AddRuleDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: PortalAccountView[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>(accounts[0]?.id ?? '');
  const [priority, setPriority] = useState<number>(10);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();

    if (!selectedAccount || !name) {
      setError('Please provide rule name and account');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await createOrderingRuleAction({
        portalAccountId: selectedAccount,
        name,
        priority,
        enabled: true,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rule');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Ordering Rule</DialogTitle>
          <DialogDescription>
            Specify a priority rule for automated benefit selection on the RuPay portal.
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
            <Label htmlFor="rule-name" className="text-xs font-semibold">Rule Name</Label>
            <Input id="rule-name" name="name" placeholder="e.g. Order Spa & BMS First" required className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="priority" className="text-xs font-semibold">Priority (1 = Highest)</Label>
            <Input
              id="priority"
              name="priority"
              type="number"
              min={1}
              max={100}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              required
              className="h-9 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Candidates matching rules with lower priority run before higher priority rules.
            </p>
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
              Create Rule
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
