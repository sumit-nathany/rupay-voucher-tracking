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
    <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base sm:text-lg text-foreground">
                RuPay Portal Accounts
              </h3>
              {accounts.length > 0 && (
                <>
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-xs font-medium">
                    {activeCount} {activeCount === 1 ? 'active' : 'active'}
                  </Badge>
                  {cooldownCount > 0 && (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium">
                      {cooldownCount} in cooldown
                    </Badge>
                  )}
                </>
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {accounts.length > 0
                ? `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} configured. Manage sign-in credentials, status, and card mappings.`
                : 'Connect a RuPay Benefits portal account to enable automated voucher ordering for your cards.'}
            </p>
          </div>
        </div>

        <Button asChild size="sm" className="h-9 px-4 rounded-xl gap-2 text-xs sm:text-sm font-medium shrink-0 self-start sm:self-auto">
          <Link href="/accounts">
            {accounts.length > 0 ? (
              <>
                Manage Accounts
                <ArrowRight className="h-4 w-4" />
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add Account
              </>
            )}
          </Link>
        </Button>
      </div>
    </div>
  );
}
