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
    <div className="space-y-2.5">
      <div className="space-y-0.5">
        <h3 className="text-base font-semibold text-foreground">RuPay Portal Accounts</h3>
        <p className="text-xs text-muted-foreground">
          Portal sign-in credentials and card mappings are configured on the dedicated Accounts page.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3 sm:px-4 sm:py-3 shadow-xs hover:border-border transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-foreground">
                {accounts.length} {accounts.length === 1 ? 'RuPay Account' : 'RuPay Accounts'} Configured
              </span>
              {accounts.length > 0 && (
                <>
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-[11px] font-medium px-1.5 py-0">
                    {activeCount} active
                  </Badge>
                  {cooldownCount > 0 && (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px] font-medium px-1.5 py-0">
                      {cooldownCount} in cooldown
                    </Badge>
                  )}
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {accounts.length > 0
                ? 'Manage credentials, verification status, and card mappings'
                : 'Connect an account to enable automated voucher ordering'}
            </p>
          </div>
        </div>

        <Button asChild size="sm" variant="outline" className="h-8 px-3 rounded-lg gap-1.5 text-xs font-semibold shrink-0 self-start sm:self-auto border-border/80 hover:bg-accent cursor-pointer">
          <Link href="/accounts">
            {accounts.length > 0 ? (
              <>
                Manage Accounts
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Add Account
              </>
            )}
          </Link>
        </Button>
      </div>
    </div>
  );
}
