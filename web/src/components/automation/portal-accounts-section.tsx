'use client';

import { useState } from 'react';
import { Plus, KeyRound, Pause, Play, Trash2, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { PortalAccountView } from '@/domain/automation';
import {
  createPortalAccountAction,
  updatePortalAccountAction,
  pausePortalAccountAction,
  resumePortalAccountAction,
  deletePortalAccountAction,
} from '@/actions/automation';

export function PortalAccountsSection({ accounts }: { accounts: PortalAccountView[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<PortalAccountView | null>(null);

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">RuPay Portal Accounts</h2>
          <p className="text-xs text-muted-foreground">
            Sign-in credentials used by the automated worker. Encrypted with AES-256-GCM.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} className="h-8 gap-1.5 text-xs font-semibold">
          <Plus className="h-3.5 w-3.5" />
          Add Account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-8 text-center bg-muted/10">
          <KeyRound className="h-8 w-8 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-semibold text-foreground">No Portal Accounts Configured</p>
          <p className="text-xs text-muted-foreground max-w-sm mt-1">
            Connect a RuPay Benefits portal login to enable unattended ordering for your mapped cards.
          </p>
          <Button size="sm" onClick={() => setAddOpen(true)} className="mt-4 h-8 text-xs font-semibold">
            Add RuPay Account
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {accounts.map((acc) => (
            <AccountCard
              key={acc.id}
              account={acc}
              onEdit={() => setEditAccount(acc)}
            />
          ))}
        </div>
      )}

      {/* Add Account Modal */}
      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} />

      {/* Edit Account / Update Credentials Modal */}
      {editAccount && (
        <EditAccountDialog
          account={editAccount}
          open={Boolean(editAccount)}
          onOpenChange={(o) => {
            if (!o) setEditAccount(null);
          }}
        />
      )}
    </div>
  );
}

function AccountCard({
  account,
  onEdit,
}: {
  account: PortalAccountView;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleTogglePause() {
    setBusy(true);
    try {
      if (account.status === 'paused') {
        await resumePortalAccountAction({ id: account.id });
      } else {
        await pausePortalAccountAction({ id: account.id });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Are you sure you want to disconnect "${account.label}"?`)) return;
    setBusy(true);
    try {
      await deletePortalAccountAction({ id: account.id });
    } finally {
      setBusy(false);
    }
  }

  const statusTone = {
    connected: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    paused: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    needs_attention: 'border-destructive/30 bg-destructive/10 text-destructive',
    credentials_expired: 'border-destructive/30 bg-destructive/10 text-destructive',
    challenge_required: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    portal_changed: 'border-destructive/30 bg-destructive/10 text-destructive',
  }[account.status];

  return (
    <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-xs space-y-3">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-foreground leading-tight">{account.label}</h3>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <CreditCard className="h-3 w-3" />
              {account.mappingsCount} mapped {account.mappingsCount === 1 ? 'card' : 'cards'} • {account.rulesCount} rules
            </p>
          </div>
          <Badge variant="outline" className={`text-[10px] font-semibold uppercase tracking-wider capitalize ${statusTone}`}>
            {account.status.replace('_', ' ')}
          </Badge>
        </div>

        {account.statusDetailCode && (
          <p className="text-[11px] font-medium text-destructive">
            Reason: {account.statusDetailCode.replace(/_/g, ' ')}
          </p>
        )}

        <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1 border-t border-border/40">
          <p>
            Last confirmed order:{' '}
            <span className="text-foreground font-medium">
              {account.lastConfirmedOrderAt
                ? new Date(account.lastConfirmedOrderAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : 'None yet'}
            </span>
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border/50">
        <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 text-xs font-semibold px-2">
          Update Credentials
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => void handleTogglePause()}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title={account.status === 'paused' ? 'Resume Account' : 'Pause Account'}
          >
            {account.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => void handleDelete()}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title="Disconnect Account"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get('label') ?? '').trim();
    const loginId = String(fd.get('loginId') ?? '').trim();
    const password = String(fd.get('password') ?? '').trim();
    const pin = String(fd.get('pin') ?? '').trim();

    if (!label || !loginId || !password) {
      setError('Please fill in label, login ID, and password');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await createPortalAccountAction({
        label,
        credentials: {
          loginId,
          password,
          extra: pin ? { pin } : undefined,
        },
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect RuPay Portal Account</DialogTitle>
          <DialogDescription>
            Enter your RuPay Benefits portal login. Credentials are encrypted and never exposed in browser or logs.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="label" className="text-xs font-semibold">Account Label</Label>
            <Input id="label" name="label" placeholder="e.g. My Primary RuPay Login" required className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loginId" className="text-xs font-semibold">Login ID / Registered Mobile or Email</Label>
            <Input id="loginId" name="loginId" placeholder="e.g. 9876543210 or email" required className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-semibold">Password</Label>
            <Input id="password" name="password" type="password" required className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pin" className="text-xs font-semibold">Security PIN (optional)</Label>
            <Input id="pin" name="pin" placeholder="Optional portal PIN" className="h-9 text-sm" />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-8 text-xs font-semibold">
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="h-8 text-xs font-semibold">
              Save Account
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAccountDialog({
  account,
  open,
  onOpenChange,
}: {
  account: PortalAccountView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get('label') ?? '').trim();
    const loginId = String(fd.get('loginId') ?? '').trim();
    const password = String(fd.get('password') ?? '').trim();
    const pin = String(fd.get('pin') ?? '').trim();

    setBusy(true);
    setError(null);
    try {
      await updatePortalAccountAction({
        id: account.id,
        label: label || undefined,
        credentials:
          loginId && password
            ? {
                loginId,
                password,
                extra: pin ? { pin } : undefined,
              }
            : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update RuPay Portal Account</DialogTitle>
          <DialogDescription>
            Update the account label or provide fresh credentials. Leave credentials blank to keep existing ones.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-label" className="text-xs font-semibold">Account Label</Label>
            <Input id="edit-label" name="label" defaultValue={account.label} required className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-loginId" className="text-xs font-semibold">New Login ID (optional)</Label>
            <Input id="edit-loginId" name="loginId" placeholder="Leave blank to keep current" className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-password" className="text-xs font-semibold">New Password (optional)</Label>
            <Input id="edit-password" name="password" type="password" placeholder="Leave blank to keep current" className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-pin" className="text-xs font-semibold">New PIN (optional)</Label>
            <Input id="edit-pin" name="pin" placeholder="Leave blank to keep current" className="h-9 text-sm" />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-8 text-xs font-semibold">
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="h-8 text-xs font-semibold">
              Update
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
