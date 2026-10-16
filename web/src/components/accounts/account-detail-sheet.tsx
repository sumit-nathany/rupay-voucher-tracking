'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  KeyRound,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  deletePortalAccountAction,
  deletePortalCardMappingAction,
  pausePortalAccountAction,
  resumePortalAccountAction,
  updatePortalAccountAction,
} from '@/actions/automation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { MappingDialog, type CardOption } from '@/components/automation/mapping-dialogs';
import type { PortalAccountView, PortalCardMappingView } from '@/domain/automation';
import { useRunAction } from '../holders/form-kit';

const SHOW_WHATSAPP = false;

export interface AccountDetailSheetProps {
  account: PortalAccountView;
  allAccounts: PortalAccountView[];
  mappings: PortalCardMappingView[];
  availableCards: CardOption[];
}

export function AccountDetailSheet({
  account,
  allAccounts,
  mappings,
  availableCards,
}: AccountDetailSheetProps) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'view' | 'edit' | 'delete'>('view');

  // Mapping dialog state
  const [mapDialogOpen, setMapDialogOpen] = React.useState(false);
  const [editingMapping, setEditingMapping] = React.useState<PortalCardMappingView | null>(null);
  const [localMappings, setLocalMappings] = React.useState<PortalCardMappingView[]>(mappings);

  // Form edit state
  const { run, pending, error, setError } = useRunAction();
  const [label, setLabel] = React.useState(account.label);
  const [phoneNumber, setPhoneNumber] = React.useState(account.phoneNumber ?? '');
  const [loginId, setLoginId] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [feedback, setFeedback] = React.useState<string | null>(null);

  // Sync state whenever account or open state changes
  React.useEffect(() => {
    if (open) {
      setLabel(account.label);
      setPhoneNumber(account.phoneNumber ?? '');
      setLoginId('');
      setPassword('');
      setPin('');
      setMode('view');
      setError(null);
      setFeedback(null);
      setMapDialogOpen(false);
      setEditingMapping(null);
    }
  }, [open, account, setError]);

  React.useEffect(() => {
    setLocalMappings(mappings);
  }, [mappings]);

  const isCooldown =
    account.status === 'connected' &&
    Boolean(account.cooldownUntil && new Date(account.cooldownUntil) > new Date());

  const formattedCooldownTime = formatCooldown(account.cooldownUntil);
  const accountMappings = localMappings.filter((m) => m.portalAccountId === account.id);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(
      () =>
        updatePortalAccountAction({
          id: account.id,
          label: label.trim() || undefined,
          phoneNumber: phoneNumber.trim() || null,
          credentials:
            loginId.trim() && password.trim()
              ? {
                  loginId: loginId.trim(),
                  password: password.trim(),
                  extra: pin.trim() ? { pin: pin.trim() } : undefined,
                }
              : undefined,
        }),
      'Could not save account. Check that the label is unique.',
    );
    if (ok) {
      setFeedback('Account details updated successfully.');
      setMode('view');
    }
  }

  async function handleTogglePause() {
    const isCurrentlyPaused = account.status === 'paused';
    setFeedback(null);
    const ok = await run(
      () =>
        isCurrentlyPaused
          ? resumePortalAccountAction({ id: account.id })
          : pausePortalAccountAction({ id: account.id }),
      `Failed to ${isCurrentlyPaused ? 'resume' : 'pause'} account`,
    );
    if (ok) {
      setFeedback(`Account ${isCurrentlyPaused ? 'resumed' : 'paused'} successfully.`);
    }
  }

  async function handleUnmapCard(id: string, cardName: string) {
    if (!confirm(`Remove card mapping for "${cardName}"?`)) return;
    setError(null);
    setFeedback(null);
    const ok = await run(
      () => deletePortalCardMappingAction({ id }),
      'Failed to unmap card',
    );
    if (ok) {
      setLocalMappings((prev) => prev.filter((m) => m.id !== id));
      setFeedback(`Card "${cardName}" removed from this account.`);
    }
  }

  async function handleDelete() {
    setError(null);
    const ok = await run(
      () => deletePortalAccountAction({ id: account.id }),
      'Failed to disconnect account',
    );
    if (ok) {
      setOpen(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="group w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl"
            aria-label={`View details for ${account.label}`}
          >
            <Card className="h-full overflow-hidden rounded-2xl border border-border/70 transition-all hover:border-foreground/25 hover:shadow-xs group-hover:bg-accent/20 cursor-pointer">
              <CardContent className="flex flex-row items-center justify-between gap-4 p-5 sm:p-6">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div
                    aria-hidden
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 text-primary shadow-xs transition-transform group-hover:scale-105"
                  >
                    <KeyRound className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-base sm:text-lg leading-snug text-foreground group-hover:text-primary transition-colors">
                        {account.label}
                      </span>
                      {isCooldown ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-semibold gap-1"
                        >
                          <Clock className="h-3 w-3" />
                          Cooldown
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={`text-xs font-medium tracking-wider capitalize ${getStatusTone(account.status)}`}
                        >
                          {account.status.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground">
                      <span>
                        {account.mappingsCount} {account.mappingsCount === 1 ? 'card' : 'cards'} mapped
                      </span>
                      {account.phoneNumber && <span>• OTP: {account.phoneNumber}</span>}
                      {isCooldown && formattedCooldownTime && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          • Unlocks {formattedCooldownTime}
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

        <SheetContent className="sm:max-w-lg w-full flex flex-col justify-between overflow-y-auto">
          {mode === 'view' && (
            <div className="flex flex-1 flex-col justify-between">
              <div className="space-y-6">
                <SheetHeader>
                  <div className="flex items-center gap-3.5">
                    <div
                      aria-hidden
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/25 text-primary shadow-xs"
                    >
                      <KeyRound className="h-6 w-6" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <SheetTitle className="text-xl font-bold leading-tight truncate">
                          {account.label}
                        </SheetTitle>
                        {isCooldown ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-semibold gap-1"
                          >
                            <Clock className="h-3 w-3" />
                            Cooldown
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className={`text-xs font-medium tracking-wider capitalize ${getStatusTone(account.status)}`}
                          >
                            {account.status.replace('_', ' ')}
                          </Badge>
                        )}
                      </div>
                      <SheetDescription className="truncate">
                        RuPay Benefits portal credentials & automated checkout configuration
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>

                {/* Feedback Alerts */}
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
                    <p className="text-muted-foreground/90 text-xs leading-relaxed">
                      RuPay limits each portal login to 1 booking per 24 hours. This account unlocks{' '}
                      <strong>{formattedCooldownTime ?? 'soon'} (IST)</strong>. Automated runs will safely wait until then.
                    </p>
                  </div>
                )}

                {/* Account Properties List */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Account Properties
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Account Label</span>
                      <span className="font-medium text-foreground truncate max-w-[220px]">{account.label}</span>
                    </div>
                    {SHOW_WHATSAPP && (
                      <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                        <span className="text-muted-foreground">WhatsApp OTP Phone</span>
                        <span className="font-medium text-foreground">
                          {account.phoneNumber || 'Workspace default'}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Status</span>
                      <span className={`font-medium text-foreground capitalize ${getStatusTone(account.status)}`}>
                        {account.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Mapped Cards</span>
                      <span className="font-medium text-foreground">
                        {account.mappingsCount} {account.mappingsCount === 1 ? 'card' : 'cards'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Ordering Rules</span>
                      <span className="font-medium text-foreground">
                        {account.rulesCount} {account.rulesCount === 1 ? 'rule' : 'rules'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Last Confirmed Order</span>
                      <span className="font-medium text-foreground">
                        {formatDate(account.lastConfirmedOrderAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        Stored Credentials
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">
                        ●●●●●●●● (AES-256-GCM encrypted)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mapped Cards for this Account */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <CreditCard className="h-3.5 w-3.5" />
                      Mapped Cards ({accountMappings.length})
                    </h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingMapping(null);
                        setMapDialogOpen(true);
                      }}
                      className="h-7 text-xs font-semibold gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      Map Card
                    </Button>
                  </div>

                  {accountMappings.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/80 p-4 text-center bg-muted/10">
                      <p className="text-xs text-muted-foreground">
                        No cards mapped to this RuPay account yet.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {accountMappings.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between gap-2.5 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-semibold text-foreground truncate">{m.cardName}</div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                              <span>
                                {m.holderName} {m.last4 ? `(••${m.last4})` : ''}
                              </span>
                              {m.paymentDetails ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-medium py-0 px-1 gap-0.5"
                                >
                                  <ShieldCheck className="h-2.5 w-2.5" />
                                  {m.paymentDetails.mode === 'full' ? 'Full card' : 'Saved card CVV'}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-amber-600 dark:text-amber-400">
                                  No checkout details
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingMapping(m);
                                setMapDialogOpen(true);
                              }}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Edit card mapping"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={pending}
                              onClick={() => void handleUnmapCard(m.id, m.cardName)}
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Remove mapping"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Pause / Resume Action Card */}
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
                    disabled={pending}
                    onClick={handleTogglePause}
                    className="h-8 text-xs font-semibold gap-1.5 shrink-0"
                  >
                    {pending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : account.status === 'paused' ? (
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
              </div>

              <SheetFooter className="mt-8 pt-4 border-t border-border/50 flex flex-row items-center justify-between gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive border-border/70 gap-1.5"
                  onClick={() => setMode('delete')}
                >
                  <Trash2 className="h-4 w-4" />
                  Disconnect
                </Button>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                  <Button type="button" className="gap-1.5" onClick={() => setMode('edit')}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                </div>
              </SheetFooter>
            </div>
          )}

          {mode === 'edit' && (
            <form onSubmit={onSubmit} className="flex flex-1 flex-col justify-between">
              <div className="space-y-5">
                <SheetHeader>
                  <SheetTitle>Edit RuPay Account</SheetTitle>
                  <SheetDescription>
                    Update account label, OTP mobile number, and portal credentials.
                  </SheetDescription>
                </SheetHeader>

                {error && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="sheet-label" className="text-xs font-medium">
                      Account Label / Email
                    </Label>
                    <Input
                      id="sheet-label"
                      name="label"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      required
                      className="h-9 text-sm"
                    />
                  </div>

                  {SHOW_WHATSAPP && (
                    <div className="space-y-1.5">
                      <Label htmlFor="sheet-phoneNumber" className="text-xs font-medium">
                        WhatsApp Phone for OTP (optional)
                      </Label>
                      <Input
                        id="sheet-phoneNumber"
                        name="phoneNumber"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="e.g. +919876543210"
                        className="h-9 text-sm font-mono"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Used on payment gateways for 3D-Secure bank OTP prompts.
                      </p>
                    </div>
                  )}

                  <div className="pt-2 border-t border-border/40 space-y-3">
                    <p className="text-xs font-medium text-foreground">Update Portal Credentials (optional)</p>
                    <p className="text-[11px] text-muted-foreground">
                      Leave blank to keep existing stored credentials unchanged.
                    </p>

                    <div className="space-y-1.5">
                      <Label htmlFor="sheet-loginId" className="text-xs font-medium">
                        New Login ID / Email
                      </Label>
                      <Input
                        id="sheet-loginId"
                        name="loginId"
                        placeholder="Leave blank to keep existing"
                        value={loginId}
                        onChange={(e) => setLoginId(e.target.value)}
                        className="h-9 text-sm bg-background"
                        autoComplete="off"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="sheet-password" className="text-xs font-medium">
                        New Password
                      </Label>
                      <Input
                        id="sheet-password"
                        name="password"
                        type="password"
                        placeholder="Leave blank to keep existing"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-9 text-sm bg-background"
                        autoComplete="new-password"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="sheet-pin" className="text-xs font-medium">
                        Security PIN (optional)
                      </Label>
                      <Input
                        id="sheet-pin"
                        name="pin"
                        placeholder="Optional portal PIN"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        className="h-9 text-sm bg-background"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <SheetFooter className="mt-8 pt-4 border-t border-border/50 flex flex-row items-center justify-between gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setMode('view');
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending} className="gap-1.5">
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save changes
                </Button>
              </SheetFooter>
            </form>
          )}

          {mode === 'delete' && (
            <div className="flex flex-1 flex-col justify-between">
              <div className="space-y-4">
                <SheetHeader>
                  <SheetTitle className="text-destructive">Disconnect RuPay Account?</SheetTitle>
                  <SheetDescription>
                    Are you sure you want to disconnect &quot;{account.label}&quot;?
                  </SheetDescription>
                </SheetHeader>
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive space-y-2">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    This action cannot be undone
                  </p>
                  <p className="leading-relaxed">
                    Disconnecting this account will remove stored credentials and unlink all{' '}
                    <strong>{account.mappingsCount} mapped card(s)</strong>.
                  </p>
                </div>
                {error && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <SheetFooter className="mt-8 pt-4 border-t border-border/50 flex flex-row items-center justify-between gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMode('view')}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={handleDelete}
                  className="gap-1.5"
                >
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Disconnect
                </Button>
              </SheetFooter>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <MappingDialog
        open={mapDialogOpen}
        onOpenChange={setMapDialogOpen}
        accounts={allAccounts}
        cards={availableCards}
        existing={editingMapping}
        defaultAccountId={account.id}
        mappings={localMappings}
      />
    </>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'None yet';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatCooldown(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const cd = new Date(dateStr);
  const now = new Date();
  const isToday = cd.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = cd.toDateString() === tomorrow.toDateString();

  const timeStr = cd.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });

  const dayPrefix = isToday
    ? 'Today'
    : isTomorrow
    ? 'Tomorrow'
    : cd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

  return `${dayPrefix} at ${timeStr}`;
}

function getStatusTone(status: PortalAccountView['status']): string {
  switch (status) {
    case 'connected':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'paused':
      return 'border-muted-foreground/30 bg-muted/40 text-muted-foreground';
    case 'needs_attention':
    case 'credentials_expired':
    case 'portal_changed':
    case 'challenge_required':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    default:
      return 'border-destructive/30 bg-destructive/10 text-destructive';
  }
}