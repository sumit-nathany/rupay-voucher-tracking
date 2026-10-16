'use client';

import Link from 'next/link';
import { KeyRound, ArrowRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
        {accounts.length > 0 && (
          <Button asChild className="gap-2 text-sm font-medium h-10 px-4 rounded-xl self-start sm:self-auto">
            <Link href="/accounts">
              Manage RuPay Accounts
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
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
        <div className="rounded-2xl border border-border/70 bg-card/60 p-5 sm:p-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
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
              Credentials, account status, pause/resume controls, and card mappings are managed on the dedicated RuPay Accounts page.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
