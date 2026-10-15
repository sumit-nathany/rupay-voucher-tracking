'use client';

import * as React from 'react';
import { AlertTriangle, Calendar, ChevronRight, CreditCard, KeyRound, Loader2, Mail, Pencil, ShieldCheck, Trash2, User } from 'lucide-react';
import { deletePortalAccountAction, updatePortalAccountAction } from '@/actions/automation';
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
import { ErrorText, Field, SubmitButton, useRunAction } from '../holders/form-kit';

export interface AccountDetailData {
  id: string;
  label: string;
  phoneNumber: string | null;
  status: 'connected' | 'paused' | 'credentials_expired' | 'challenge_required' | 'portal_changed' | 'needs_attention';
  hasCredentials: boolean;
  lastConfirmedOrderAt: string | null;
  lastCheckedAt: string | null;
  statusDetailCode: string | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
  mappingsCount: number;
  rulesCount: number;
}

export function AccountDetailSheet({
  account,
}: {
  account: AccountDetailData;
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'view' | 'edit' | 'delete'>('view');

   // Form edit state
   const { run, pending, error, setError } = useRunAction();
  const [label, setLabel] = React.useState(account.label);
  const [phoneNumber, setPhoneNumber] = React.useState(account.phoneNumber ?? '');
  const [status, setStatus] = React.useState(account.status);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(
      () =>
        updatePortalAccountAction({
          id: account.id,
          label: label || undefined,
          phoneNumber: phoneNumber || null,
          // Note: credentials update is not included in this simple form; 
          // for credentials, we would need a separate flow or include in the form.
          // For now, we only update label and phone number.
        }),
      'Could not save. Check the label is unique.',
    );
    if (ok) {
      setMode('view');
      setOpen(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Disconnect account "${account.label}"? This cannot be undone.`)) return;
    setMode('delete');
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
        <SheetContent className="sm:max-w-md w-full flex flex-col justify-between overflow-y-auto">
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
                        <SheetDescription className="truncate">
                          RuPay Benefits portal credentials
                        </SheetDescription>
                      </div>
                    </div>
                  </div>
                </SheetHeader>

                {/* Feedback Alerts */}
                {error && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                    <span>{error}</span>
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
                      <span className="font-medium text-foreground">{account.label}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">WhatsApp OTP Phone</span>
                      <span className="font-medium text-foreground">
                        {account.phoneNumber || 'Workspace default'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Status</span>
                      <span className={`font-medium text-foreground capitalize ${getStatusTone(account.status)}`}>
                        {account.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40">
                      <span className="text-muted-foreground">Has Credentials</span>
                      <span className="font-medium text-foreground">
                        {account.hasCredentials ? 'Yes' : 'No'}
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
                        {account.lastConfirmedOrderAt
                          ? new Date(account.lastConfirmedOrderAt).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : 'None yet'}
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
                    Update account label and WhatsApp phone number for OTP.
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
                </div>

                <SheetFooter className="mt-8 pt-4 border-t border-border/50 flex flex-row items-center justify-end gap-2">
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
                    Save Changes
                  </Button>
                </SheetFooter>
              </div>
            </form>
          )}

          {mode === 'delete' && (
            <div className="flex flex-1 flex-col justify-between">
              <div className="space-y-5">
                <SheetHeader>
                  <SheetTitle className="text-destructive">Disconnect Account</SheetTitle>
                  <SheetDescription>
                    Are you sure you want to disconnect &ldquo;{account.label}&rdquo;?
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
              </div>

              <SheetFooter className="mt-8 pt-4 border-t border-border/50 flex flex-row items-center justify-end gap-2">
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
    </>
  );
}

function getStatusTone(status: AccountDetailData['status']): string {
  switch (status) {
    case 'connected':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'paused':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'needs_attention':
    case 'credentials_expired':
    case 'portal_changed':
    case 'challenge_required':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    default:
      return 'border-destructive/30 bg-destructive/10 text-destructive';
  }
}