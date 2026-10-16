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
    <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs flex flex-col justify-between h-full space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-foreground leading-tight">
                RuPay Accounts
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sign-in & card mappings
              </p>
            </div>
          </div>
          {accounts.length > 0 && (
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-xs font-medium">
              {activeCount} active
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          {accounts.length > 0
            ? `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'} configured. Credentials and card mappings are managed on the dedicated page.`
            : 'Connect your RuPay portal logins to enable automated voucher ordering for your cards.'}
        </p>

        {cooldownCount > 0 && (
          <div className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px] py-0 px-1.5 font-medium">
              {cooldownCount} in cooldown
            </Badge>
          </div>
        )}
      </div>

      <div className="pt-1">
        <Button asChild size="sm" variant="outline" className="w-full h-9 rounded-xl gap-2 text-xs font-semibold cursor-pointer border-border/80 hover:bg-accent">
          <Link href="/accounts">
            {accounts.length > 0 ? (
              <>
                Manage Accounts
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Add RuPay Account
              </>
            )}
          </Link>
        </Button>
      </div>
    </div>
  );
}
