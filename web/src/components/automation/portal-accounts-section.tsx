'use client';

import { useState } from 'react';
import {
  Plus,
  KeyRound,
  Pause,
  Play,
  Trash2,
  Clock,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
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
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Resolve currently selected account from live accounts array (keeps state updated on pause/update)
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

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
              onClick={() => setSelectedAccountId(acc.id)}
            />
          ))}
        </div>
      )}

      {/* Add Account Modal */}
      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} />

      {/* Slide-Over Drawer for Account Details, Credentials Update, Pause, and Delete */}
      <PortalAccountDetailSheet
        account={selectedAccount}
        open={Boolean(selectedAccount)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedAccountId(null);
        }}
      />
    </div>
  );
}

function AccountCard({
  account,
  onClick,
}: {
  account: PortalAccountView;
  onClick: () => void;
}) {
  const isCooldown =
    account.status === 'connected' &&
    Boolean(account.cooldownUntil && new Date(account.cooldownUntil) > new Date());

  const statusTone = {
    connected: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    paused: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    needs_attention: 'border-destructive/30 bg-destructive/10 text-destructive',
    credentials_expired: 'border-destructive/30 bg-destructive/10 text-destructive',
    challenge_required: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    portal_changed: 'border-destructive/30 bg-destructive/10 text-destructive',
  }[account.status];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="group flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-5 shadow-xs hover:border-primary/50 hover:shadow-md transition-all cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none"
    >
      <div className="space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 shadow-xs group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <KeyRound className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-foreground truncate" title={account.label}>
                {account.label}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {account.mappingsCount} mapped {account.mappingsCount === 1 ? 'card' : 'cards'} • {account.rulesCount}{' '}
                {account.rulesCount === 1 ? 'rule' : 'rules'}
              </p>
            </div>
          </div>

          {isCooldown ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold gap-1 shrink-0"
            >
              <Clock className="h-3 w-3" />
              Cooldown
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className={`text-[10px] font-semibold tracking-wider shrink-0 capitalize ${statusTone}`}
            >
              {account.status.replace('_', ' ')}
            </Badge>
          )}
        </div>

        {/* 24h Portal Limit Cooldown Callout */}
        {isCooldown && account.cooldownUntil && (
          <div className="flex items-center justify-between rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-1.5 font-medium">
              <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                Unlocks{' '}
                {new Date(account.cooldownUntil).toLocaleString('en-IN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata',
                })}{' '}
                IST
              </span>
            </div>
            <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">24h limit</span>
          </div>
        )}

        {/* Real Error Callout */}
        {account.status !== 'connected' &&
          account.statusDetailCode &&
          account.statusDetailCode !== 'daily_limit_reached' && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Action needed: {account.statusDetailCode.replace(/_/g, ' ')}
            </div>
          )}

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/50 text-xs">
          <div>
            <span className="text-[11px] text-muted-foreground block">Last confirmed order</span>
            <span className="font-medium text-foreground text-xs mt-0.5 block">
              {account.lastConfirmedOrderAt
                ? new Date(account.lastConfirmedOrderAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : 'None yet'}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground block">WhatsApp OTP</span>
            <span className="font-medium text-foreground text-xs font-mono mt-0.5 block">
              {account.phoneNumber || 'Workspace default'}
            </span>
          </div>
        </div>
      </div>

      {/* Card Footer Click Hint */}
      <div className="flex items-center justify-between pt-3 border-t border-border/40 mt-3 text-xs text-muted-foreground">
        <span className="text-[11px] font-medium group-hover:text-primary transition-colors">
          Manage credentials & settings
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  );
}

function PortalAccountDetailSheet({
  account,
  open,
  onOpenChange,
}: {
  account: PortalAccountView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!account) return null;

  async function handleTogglePause() {
    if (!account) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      if (account.status === 'paused') {
        await resumePortalAccountAction({ id: account.id });
        setFeedback('Account resumed! Automated orders will now include this account.');
      } else {
        await pausePortalAccountAction({ id: account.id });
        setFeedback('Account paused! The automated worker will skip this account.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account pause state');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!account) return;
    if (!confirm(`Are you sure you want to disconnect "${account.label}"? All linked card mappings will be removed.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deletePortalAccountAction({ id: account.id });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setBusy(false);
    }
  }

  async function handleUpdateCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!account) return;

    const fd = new FormData(e.currentTarget);
    const label = String(fd.get('label') ?? '').trim();
    const phoneNumber = String(fd.get('phoneNumber') ?? '').trim();
    const loginId = String(fd.get('loginId') ?? '').trim();
    const password = String(fd.get('password') ?? '').trim();
    const pin = String(fd.get('pin') ?? '').trim();

    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await updatePortalAccountAction({
        id: account.id,
        label: label || undefined,
        phoneNumber: phoneNumber || null,
        credentials:
          loginId && password
            ? {
                loginId,
                password,
                extra: pin ? { pin } : undefined,
              }
            : undefined,
      });
      setFeedback('Account details and credentials updated successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update credentials');
    } finally {
      setBusy(false);
    }
  }

  const isCooldown =
    account.status === 'connected' &&
    Boolean(account.cooldownUntil && new Date(account.cooldownUntil) > new Date());

  const statusTone = {
    connected: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    paused: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    needs_attention: 'border-destructive/30 bg-destructive/10 text-destructive',
    credentials_expired: 'border-destructive/30 bg-destructive/10 text-destructive',
    challenge_required: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    portal_changed: 'border-destructive/30 bg-destructive/10 text-destructive',
  }[account.status];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md w-full flex flex-col justify-between overflow-y-auto">
        <div className="space-y-6">
          <SheetHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <SheetTitle className="text-base font-bold text-foreground leading-tight">
                  {account.label}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground mt-0.5">
                  RuPay Benefits portal credentials & automated checkout configuration
                </SheetDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              {isCooldown ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold gap-1"
                >
                  <Clock className="h-3 w-3" />
                  Cooldown Active
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className={`text-[10px] font-semibold tracking-wider capitalize ${statusTone}`}
                >
                  {account.status.replace('_', ' ')}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {account.mappingsCount} mapped {account.mappingsCount === 1 ? 'card' : 'cards'} • {account.rulesCount}{' '}
                {account.rulesCount === 1 ? 'rule' : 'rules'}
              </span>
            </div>
          </SheetHeader>

          {/* Feedback & Error alerts */}
          {feedback && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{feedback}</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <span>{error}</span>
            </div>
          )}

          {/* 24h Cooldown Alert Banner */}
          {isCooldown && account.cooldownUntil && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  24-Hour Portal Limit Active
                </span>
                <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">Cooldown</span>
              </div>
              <p className="text-muted-foreground/90 text-[11px] leading-relaxed">
                RuPay limits each portal login to 1 booking per 24 hours. This account unlocks{' '}
                <strong>
                  {new Date(account.cooldownUntil).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Kolkata',
                  })}{' '}
                  IST
                </strong>
                . Automated runs will safely wait until then.
              </p>
            </div>
          )}

          {/* Edit Credentials Form */}
          <form onSubmit={(e) => void handleUpdateCredentials(e)} className="space-y-4 pt-1 border-t border-border/50">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Credentials & Details</h4>

            <div className="space-y-1.5">
              <Label htmlFor="sheet-label" className="text-xs font-medium">
                Account Label
              </Label>
              <Input
                id="sheet-label"
                name="label"
                defaultValue={account.label}
                required
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sheet-phoneNumber" className="text-xs font-medium">
                WhatsApp Phone for OTP (optional)
              </Label>
              <Input
                id="sheet-phoneNumber"
                name="phoneNumber"
                defaultValue={account.phoneNumber ?? ''}
                placeholder="e.g. +919876543210"
                className="h-9 text-sm font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Override workspace default phone for 3D-Secure bank OTP prompts.
              </p>
            </div>

            <div className="space-y-3 pt-2 rounded-xl border border-border/70 bg-muted/20 p-3">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Update Portal Password (optional)
              </p>
              <p className="text-[11px] text-muted-foreground">
                Leave blank to keep existing encrypted credentials. Fill in both fields only to replace your stored login.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="sheet-loginId" className="text-xs font-medium">
                  New Login ID / Email
                </Label>
                <Input
                  id="sheet-loginId"
                  name="loginId"
                  placeholder="Leave blank to keep existing"
                  className="h-9 text-sm bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sheet-password" className="text-xs font-medium">
                  New Portal Password
                </Label>
                <Input
                  id="sheet-password"
                  name="password"
                  type="password"
                  placeholder="Leave blank to keep existing"
                  className="h-9 text-sm bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sheet-pin" className="text-xs font-medium">
                  New Portal PIN (optional)
                </Label>
                <Input
                  id="sheet-pin"
                  name="pin"
                  placeholder="Optional portal PIN"
                  className="h-9 text-sm bg-background"
                />
              </div>
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={busy} className="w-full h-9 text-xs font-semibold gap-1.5">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </form>

          {/* Account Status & Danger Zone */}
          <div className="space-y-3 pt-4 border-t border-border/50">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Account Controls</h4>

            {/* Pause / Resume Action Card */}
            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 p-3.5">
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-foreground">
                  {account.status === 'paused' ? 'Account Paused' : 'Automation Active'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {account.status === 'paused'
                    ? 'Resume to include this account in automated ordering.'
                    : 'Pause to skip this account during scheduled daily runs.'}
                </p>
              </div>
              <Button
                type="button"
                variant={account.status === 'paused' ? 'default' : 'outline'}
                size="sm"
                disabled={busy}
                onClick={() => void handleTogglePause()}
                className="h-8 text-xs font-semibold gap-1.5 shrink-0"
              >
                {account.status === 'paused' ? (
                  <>
                    <Play className="h-3.5 w-3.5" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-3.5 w-3.5" /> Pause
                  </>
                )}
              </Button>
            </div>

            {/* Disconnect Action Card */}
            <div className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/5 p-3.5">
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-destructive">Disconnect Account</p>
                <p className="text-[11px] text-muted-foreground">
                  Permanently remove this account and unmap all linked cards.
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void handleDelete()}
                className="h-8 text-xs font-semibold gap-1.5 shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </div>
        </div>

        <SheetFooter className="pt-6 border-t border-border/50">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full text-xs font-semibold"
          >
            Close Panel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AddAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get('label') ?? '').trim();
    const phoneNumber = String(fd.get('phoneNumber') ?? '').trim();
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
        phoneNumber: phoneNumber || undefined,
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
            <Label htmlFor="add-label" className="text-xs font-semibold">
              Account Label
            </Label>
            <Input id="add-label" name="label" placeholder="e.g. My Primary RuPay Login" required className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-phoneNumber" className="text-xs font-semibold">
              WhatsApp Number for OTP (optional)
            </Label>
            <Input id="add-phoneNumber" name="phoneNumber" placeholder="e.g. +919876543210" className="h-9 text-sm font-mono" />
            <p className="text-[11px] text-muted-foreground">
              Receive 3D-Secure bank OTP requests directly on WhatsApp to automate checkout.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-loginId" className="text-xs font-semibold">
              Login ID / Registered Mobile or Email
            </Label>
            <Input id="add-loginId" name="loginId" placeholder="e.g. 9876543210 or email" required className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-password" className="text-xs font-semibold">
              Password
            </Label>
            <Input id="add-password" name="password" type="password" required className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-pin" className="text-xs font-semibold">
              Security PIN (optional)
            </Label>
            <Input id="add-pin" name="pin" placeholder="Optional portal PIN" className="h-9 text-sm" />
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
              Save Account
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
