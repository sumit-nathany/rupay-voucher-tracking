'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  ExternalLink,
  KeyRound,
  Loader2,
  PackageCheck,
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
import {
  getPortalStatusExplanation,
  getPortalStatusResolution,
} from '@/lib/portal-status';
import { cn } from '@/lib/utils';

import { useRunAction } from '../holders/form-kit';

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

  const isPaused = account.status === 'paused';

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
      `Failed to ${isCurrentlyPaused ? 'activate' : 'mark inactive'} account`,
    );
    if (ok) {
      setFeedback(`Account ${isCurrentlyPaused ? 'activated' : 'marked as inactive'} successfully.`);
    }
  }

  async function handleReconnect() {
    setError(null);
    setFeedback(null);
    const ok = await run(
      () => resumePortalAccountAction({ id: account.id }),
      'Failed to clear issue and reconnect account',
    );
    if (ok) {
      setFeedback('Issue cleared and account reconnected successfully.');
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
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className="group w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl cursor-pointer"
            aria-label={`View details for ${account.label}`}
          >
            <Card
              className={cn(
                'h-full overflow-hidden rounded-2xl transition-all cursor-pointer',
                isPaused
                  ? 'opacity-80 bg-muted/20 border border-dashed border-border/80 hover:opacity-100 hover:border-border hover:shadow-xs'
                  : 'border border-border/70 hover:border-foreground/25 hover:shadow-xs group-hover:bg-accent/15',
              )}
            >
              <CardContent className="flex flex-col justify-between gap-3 p-4 sm:p-5 h-full">
                {/* Top Row: Icon + Account Label & Phone */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    aria-hidden
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-xs transition-transform group-hover:scale-105',
                      isPaused
                        ? 'bg-muted/60 border border-border/60 text-muted-foreground'
                        : 'bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 text-primary',
                    )}
                  >
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'font-semibold text-sm sm:text-base leading-tight truncate transition-colors',
                        isPaused
                          ? 'text-muted-foreground group-hover:text-foreground'
                          : 'text-foreground group-hover:text-primary',
                      )}
                      title={account.label}
                    >
                      {account.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {account.phoneNumber ? `Mobile: ${account.phoneNumber}` : 'No phone linked'}
                    </p>
                  </div>
                </div>

                {/* Status Explanation (if needs attention) */}
                {account.status === 'needs_attention' && (
                  <p className="text-xs text-destructive font-medium break-words bg-destructive/10 border border-destructive/20 rounded-lg p-2">
                    {getPortalStatusExplanation(account.status, account.statusDetailCode)}
                  </p>
                )}

                {/* Bottom Row: Status Badge & Metadata + Details Link */}
                <div className="pt-2.5 border-t border-border/40 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {isCooldown ? (
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold gap-1 shrink-0 py-0"
                      >
                        <Clock className="h-2.5 w-2.5" />
                        Cooldown
                      </Badge>
                    ) : isPaused ? (
                      <Badge
                        variant="outline"
                        className="border-muted-foreground/30 bg-muted/50 text-muted-foreground text-[11px] font-medium gap-1 shrink-0 py-0"
                      >
                        <Pause className="h-2 w-2" />
                        Inactive
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className={`text-[11px] font-medium tracking-wide capitalize shrink-0 py-0 ${getStatusTone(account.status)}`}
                      >
                        {account.status.replace(/_/g, ' ')}
                      </Badge>
                    )}

                    <span className="truncate">
                      {account.mappingsCount} {account.mappingsCount === 1 ? 'card' : 'cards'} mapped
                    </span>

                    {isCooldown && formattedCooldownTime && (
                      <span className="text-amber-600 dark:text-amber-400 font-medium truncate">
                        • Unlocks {formattedCooldownTime}
                      </span>
                    )}
                  </div>

                  <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground group-hover:text-foreground shrink-0 transition-colors">
                    <span>Details</span>
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
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
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <SheetTitle className="text-xl font-bold leading-tight break-words">
                          {account.label}
                        </SheetTitle>
                        {isCooldown ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-semibold gap-1 shrink-0"
                          >
                            <Clock className="h-3 w-3" />
                            Cooldown
                          </Badge>
                        ) : account.status === 'paused' ? (
                          <Badge
                            variant="outline"
                            className="border-muted-foreground/30 bg-muted/50 text-muted-foreground text-xs font-medium gap-1 shrink-0"
                          >
                            <Pause className="h-2.5 w-2.5" />
                            Inactive (Paused)
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className={`text-xs font-medium tracking-wider capitalize shrink-0 ${getStatusTone(account.status)}`}
                          >
                            {account.status.replace(/_/g, ' ')}
                          </Badge>
                        )}
                      </div>
                      <SheetDescription className="break-words">
                        RuPay Benefits portal credentials & automated checkout configuration
                      </SheetDescription>
                    </div>
                  </div>
                  <div className="pt-2 flex items-center gap-2">
                    <Button variant="outline" size="sm" asChild className="gap-1.5">
                      <Link href={`/benefits?account=${encodeURIComponent(account.id)}&lifetime=1`}>
                        <PackageCheck className="h-4 w-4" /> View Orders Placed
                      </Link>
                    </Button>
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

                {/* Needs Attention Alert Banner */}
                {account.status === 'needs_attention' && (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive space-y-3 shadow-xs">
                    <div className="flex items-center gap-2 font-semibold text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>Account Needs Attention</span>
                    </div>
                    <p className="text-foreground/90 text-xs leading-relaxed break-words">
                      {getPortalStatusResolution(account.status, account.statusDetailCode)}
                    </p>
                    <div className="pt-1">
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending}
                        onClick={handleReconnect}
                        className="h-8 text-xs font-semibold gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
                      >
                        {pending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Clear Issue / Reconnect
                          </>
                        )}
                      </Button>
                    </div>
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
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Registered Mobile</span>
                      <span className="font-medium text-foreground">
                        {account.phoneNumber || 'Auto-detected on checkout'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Status</span>
                      <span className={`font-medium text-foreground capitalize ${getStatusTone(account.status)}`}>
                        {account.status === 'paused' ? 'Inactive (Paused)' : account.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {account.status === 'needs_attention' && account.statusDetailCode && (
                      <div className="flex items-start justify-between gap-2 py-1.5 border-b border-border/40">
                        <span className="text-muted-foreground shrink-0">Issue Detail</span>
                        <span className="font-medium text-destructive text-xs text-right break-words max-w-[240px]">
                          {getPortalStatusExplanation(account.status, account.statusDetailCode)}
                        </span>
                      </div>
                    )}
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
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Orders Placed</span>
                      <Link
                        href={`/benefits?account=${encodeURIComponent(account.id)}&lifetime=1`}
                        className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                      >
                        View all orders <ExternalLink className="h-3 w-3" />
                      </Link>
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

                {/* Status & Automation Control (Active / Inactive Toggle) */}
                {account.status === 'needs_attention' ? (
                  <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 p-4 gap-3">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <p className="text-xs font-bold text-destructive">
                        Account Needs Attention
                      </p>
                      <p className="text-[11px] text-muted-foreground break-words leading-relaxed">
                        {getPortalStatusExplanation(account.status, account.statusDetailCode)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={pending}
                      onClick={handleReconnect}
                      className="h-8 text-xs font-semibold gap-1.5 shrink-0 bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
                    >
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" /> Reconnect
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/60 p-4 gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-foreground">
                          {account.status === 'paused' ? 'Account Inactive (Paused)' : 'Account Active'}
                        </p>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] py-0 px-1.5 font-semibold',
                            account.status === 'paused'
                              ? 'border-muted-foreground/30 bg-muted text-muted-foreground'
                              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                          )}
                        >
                          {account.status === 'paused' ? 'Inactive' : 'Active'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {account.status === 'paused'
                          ? 'Automated ordering skips this account. Stored credentials and card mappings are preserved.'
                          : 'Included in automated ordering runs. Toggle to inactive anytime to pause without deleting.'}
                      </p>
                    </div>

                    {/* Active / Inactive Toggle Switch */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={account.status !== 'paused'}
                        aria-label={
                          account.status === 'paused'
                            ? `Activate account ${account.label}`
                            : `Mark account ${account.label} as inactive`
                        }
                        title={
                          account.status === 'paused'
                            ? 'Click to activate this account for automated ordering'
                            : 'Click to mark as inactive (pause automated ordering)'
                        }
                        disabled={pending}
                        onClick={handleTogglePause}
                        className={cn(
                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                          account.status === 'paused'
                            ? 'bg-muted-foreground/30 hover:bg-muted-foreground/45'
                            : 'bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600',
                        )}
                      >
                        <span
                          className={cn(
                            'pointer-events-none flex h-5 w-5 items-center justify-center rounded-full bg-background shadow-xs transition-transform duration-200 ease-in-out',
                            account.status === 'paused' ? 'translate-x-0' : 'translate-x-5',
                          )}
                        >
                          {pending ? (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          ) : account.status === 'paused' ? (
                            <Pause className="h-2.5 w-2.5 text-muted-foreground" />
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <SheetFooter className="mt-8 pt-4 border-t border-border/50 flex flex-row items-center justify-between gap-2 sm:justify-between">
                <div className="relative group/disconnect-tip">
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive border-border/70 gap-1.5 cursor-pointer text-xs sm:text-sm"
                    onClick={() => setMode('delete')}
                    title="Permanently removes this RuPay account, deletes stored credentials, and unlinks all mapped cards. To temporarily stop ordering without deleting, toggle the account to Inactive above instead."
                  >
                    <Trash2 className="h-4 w-4" />
                    Disconnect Account
                  </Button>
                  <div className="pointer-events-none absolute bottom-full mb-2 left-0 hidden group-hover/disconnect-tip:flex flex-col z-50 w-72 rounded-xl bg-popover p-3 text-xs text-popover-foreground shadow-lg border border-border animate-in fade-in-0 zoom-in-95">
                    <p className="font-semibold text-destructive flex items-center gap-1 mb-1">
                      <Trash2 className="h-3.5 w-3.5" />
                      Permanently Removes Account
                    </p>
                    <p className="text-muted-foreground leading-relaxed text-[11px]">
                      Deletes stored portal credentials and unlinks all {account.mappingsCount} mapped card(s).
                    </p>
                    <p className="text-foreground/90 font-medium leading-relaxed text-[11px] mt-1.5 pt-1.5 border-t border-border/60">
                      💡 To temporarily pause ordering without deleting credentials or cards, toggle to <strong>Inactive</strong> above instead.
                    </p>
                  </div>
                </div>
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

                  <div className="space-y-1.5">
                    <Label htmlFor="sheet-phoneNumber" className="text-xs font-medium">
                      Registered Mobile Number (optional)
                    </Label>
                    <Input
                      id="sheet-phoneNumber"
                      name="phoneNumber"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="h-9 text-sm font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Mobile number registered with this RuPay account, used on payment gateways during checkout.
                    </p>
                  </div>

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
                  <SheetTitle className="text-destructive">Disconnect & Remove RuPay Account?</SheetTitle>
                  <SheetDescription>
                    Are you sure you want to permanently remove &quot;{account.label}&quot;?
                  </SheetDescription>
                </SheetHeader>
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive space-y-2.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    Permanent Action — Cannot Be Undone
                  </p>
                  <p className="leading-relaxed">
                    Disconnecting will permanently remove stored portal credentials and unlink all{' '}
                    <strong>{account.mappingsCount} mapped card(s)</strong>.
                  </p>
                  <div className="pt-2 border-t border-destructive/20 text-foreground/90 text-xs rounded-lg bg-background/50 p-2.5">
                    <p className="font-semibold text-foreground mb-0.5 flex items-center gap-1">
                      <span>💡</span> Looking to temporarily pause orders?
                    </p>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      You don&apos;t need to disconnect! Cancel this and toggle the account to <strong>Inactive</strong>. All credentials and mapped cards will stay saved.
                    </p>
                  </div>
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
                  Confirm Disconnect & Delete
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