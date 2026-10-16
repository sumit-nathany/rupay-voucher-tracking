'use client';

import Link from 'next/link';
import {
  KeyRound,
  Clock,
  ChevronRight,
  ArrowRight,
  Plus,
  CreditCard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { PortalAccountView, PortalCardMappingView } from '@/domain/automation';
import type { CardOption } from './mapping-dialogs';

export function PortalAccountsSection({
  accounts,
}: {
  accounts: PortalAccountView[];
  mappings?: PortalCardMappingView[];
  availableCards?: CardOption[];
}) {
  const activeCount = accounts.filter((a) => a.status === 'connected').length;
  const cooldownCount = accounts.filter(
    (a) => a.status === 'connected' && Boolean(a.cooldownUntil && new Date(a.cooldownUntil) > new Date()),
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">RuPay Portal Accounts</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Sign-in credentials used by the automated worker. Encrypted with AES-256-GCM.
          </p>
        </div>
        <Button asChild className="gap-2 text-sm font-medium h-10 px-4 rounded-xl self-start sm:self-auto">
          <Link href="/accounts">
            Manage RuPay Accounts
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-12 text-center bg-muted/10">
          <KeyRound className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-base font-semibold text-foreground">No Portal Accounts Configured</p>
          <p className="text-sm text-muted-foreground max-w-sm mt-1.5">
            Connect a RuPay Benefits portal login to enable unattended ordering for your mapped cards.
          </p>
          <Button asChild className="mt-6 gap-2 text-sm font-medium h-10 px-4 rounded-xl">
            <Link href="/accounts">
              <Plus className="h-4 w-4" />
              Add RuPay Account
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Summary Overview Card linking to /accounts */}
          <Link
            href="/accounts"
            className="group block rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 sm:p-6 transition-all hover:border-primary/40 hover:shadow-xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
                    {accounts.length} {accounts.length === 1 ? 'RuPay Account' : 'RuPay Accounts'} Configured
                  </span>
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-xs">
                    {activeCount} active
                  </Badge>
                  {cooldownCount > 0 && (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs">
                      {cooldownCount} in cooldown
                    </Badge>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Credentials, account status, and pause/resume controls are managed on the dedicated RuPay Accounts page.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary group-hover:translate-x-1 transition-transform shrink-0">
                <span>Manage RuPay Accounts</span>
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </Link>

          {/* Account Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            {accounts.map((acc) => (
              <AccountSummaryCard key={acc.id} account={acc} />
            ))}
          </div>

          {/* Bottom helper prompt */}
          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-foreground">Configure Credentials & Accounts</p>
              <p className="text-xs text-muted-foreground">
                Add new accounts, update passwords/PINs, or pause ordering in RuPay Accounts.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="rounded-xl font-medium gap-1.5 shrink-0">
              <Link href="/accounts">
                Manage RuPay Accounts
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountSummaryCard({ account }: { account: PortalAccountView }) {
  const isCooldown =
    account.status === 'connected' &&
    Boolean(account.cooldownUntil && new Date(account.cooldownUntil) > new Date());

  let formattedCooldownTime: string | null = null;
  if (account.cooldownUntil) {
    const cd = new Date(account.cooldownUntil);
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

    formattedCooldownTime = `${dayPrefix} at ${timeStr}`;
  }

  const statusTone: Record<PortalAccountView['status'], string> = {
    connected: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    paused: 'border-muted-foreground/30 bg-muted/40 text-muted-foreground',
    needs_attention: 'border-destructive/30 bg-destructive/10 text-destructive',
    credentials_expired: 'border-destructive/30 bg-destructive/10 text-destructive',
    challenge_required: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    portal_changed: 'border-destructive/30 bg-destructive/10 text-destructive',
  };

  return (
    <Link
      href="/accounts"
      className="group block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl"
      aria-label={`Manage ${account.label} on RuPay Accounts`}
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
                    className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-normal text-xs leading-none gap-1 py-1"
                  >
                    <Clock className="h-3 w-3" />
                    Cooldown
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className={`font-normal text-xs leading-none py-1 capitalize ${statusTone[account.status] ?? ''}`}
                  >
                    {account.status.replace('_', ' ')}
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground">
                <Badge variant="secondary" className="gap-1.5 font-normal text-xs px-2.5 py-0.5 h-5.5">
                  <CreditCard className="h-3.5 w-3.5 opacity-70" aria-hidden />
                  {account.mappingsCount} {account.mappingsCount === 1 ? 'card' : 'cards'}
                </Badge>
                {account.phoneNumber && (
                  <span>• OTP: {account.phoneNumber}</span>
                )}
                {isCooldown && formattedCooldownTime && (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                    · Unlocks {formattedCooldownTime} IST
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center pl-2 text-muted-foreground group-hover:text-foreground">
            <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
