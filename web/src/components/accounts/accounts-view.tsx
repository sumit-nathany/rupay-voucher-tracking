'use client';

import * as React from 'react';
import { AccountDetailSheet } from '@/components/accounts/account-detail-sheet';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PortalAccountView, PortalCardMappingView } from '@/domain/automation';
import type { CardOption } from '@/components/automation/mapping-dialogs';

export interface AccountsViewProps {
  accounts: PortalAccountView[];
  mappings: PortalCardMappingView[];
  availableCards: CardOption[];
}

export function AccountsView({
  accounts,
  mappings,
  availableCards,
}: AccountsViewProps) {
  const activeAccounts = React.useMemo(
    () => accounts.filter((a) => a.active),
    [accounts],
  );
  const inactiveAccounts = React.useMemo(
    () => accounts.filter((a) => !a.active),
    [accounts],
  );

  return (
    <Tabs defaultValue="all" className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <TabsList className="bg-muted/60 p-1 rounded-xl">
          <TabsTrigger value="all" className="text-xs sm:text-sm font-medium gap-1.5 px-3 py-1.5">
            All
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] font-normal">
              {accounts.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="active" className="text-xs sm:text-sm font-medium gap-1.5 px-3 py-1.5">
            Active
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] font-normal">
              {activeAccounts.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="inactive" className="text-xs sm:text-sm font-medium gap-1.5 px-3 py-1.5">
            Inactive
            <Badge
              variant="outline"
              className={`px-1.5 py-0 text-[11px] font-normal ${
                inactiveAccounts.length > 0
                  ? 'border-muted-foreground/40 text-muted-foreground bg-muted/30'
                  : 'text-muted-foreground/60'
              }`}
            >
              {inactiveAccounts.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </div>

      {/* "All" Tab: Shows Active accounts followed by Inactive accounts if any exist */}
      <TabsContent value="all" className="space-y-8 outline-none mt-0">
        {inactiveAccounts.length > 0 ? (
          <>
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-wide text-foreground">
                    Active Accounts
                  </h2>
                  <Badge variant="secondary" className="px-1.5 py-0 text-xs font-medium">
                    {activeAccounts.length}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Active across workspace and voucher tracking
                </span>
              </div>

              {activeAccounts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/80 p-6 text-center bg-muted/10">
                  <p className="text-sm text-muted-foreground">
                    No active accounts. Reactivate an inactive account below to restore it.
                  </p>
                </div>
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                  {activeAccounts.map((account) => (
                    <li key={account.id}>
                      <AccountDetailSheet
                        account={account}
                        allAccounts={accounts}
                        mappings={mappings}
                        availableCards={availableCards}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">
                    Inactive Accounts
                  </h2>
                  <Badge
                    variant="outline"
                    className="px-1.5 py-0 text-xs font-medium border-muted-foreground/30 text-muted-foreground"
                  >
                    {inactiveAccounts.length}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Excluded from voucher selection, card assignments, and automated sweeps.
                </p>
              </div>

              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                {inactiveAccounts.map((account) => (
                  <li key={account.id}>
                    <AccountDetailSheet
                      account={account}
                      allAccounts={accounts}
                      mappings={mappings}
                      availableCards={availableCards}
                    />
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => (
              <li key={account.id}>
                <AccountDetailSheet
                  account={account}
                  allAccounts={accounts}
                  mappings={mappings}
                  availableCards={availableCards}
                />
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      {/* "Active" Tab */}
      <TabsContent value="active" className="space-y-4 outline-none mt-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-foreground">
              Active Accounts
            </h2>
            <Badge variant="secondary" className="px-1.5 py-0 text-xs font-medium">
              {activeAccounts.length}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            Available across the ecosystem for voucher assignments and card mappings
          </span>
        </div>

        {activeAccounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 p-8 text-center bg-muted/10">
            <p className="text-sm text-muted-foreground">
              No active accounts. Reactivate an inactive account to restore it to the ecosystem.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {activeAccounts.map((account) => (
              <li key={account.id}>
                <AccountDetailSheet
                  account={account}
                  allAccounts={accounts}
                  mappings={mappings}
                  availableCards={availableCards}
                />
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      {/* "Inactive" Tab */}
      <TabsContent value="inactive" className="space-y-4 outline-none mt-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-foreground">
              Inactive Accounts
            </h2>
            <Badge
              variant="outline"
              className="px-1.5 py-0 text-xs font-medium border-muted-foreground/30 text-muted-foreground"
            >
              {inactiveAccounts.length}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Retired across the entire ecosystem. Hidden from voucher dropdowns, card assignments, and sweeps.
          </p>
        </div>

        {inactiveAccounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 p-8 text-center bg-muted/10">
            <p className="text-sm text-muted-foreground">
              No inactive accounts. All accounts in this workspace are active.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {inactiveAccounts.map((account) => (
              <li key={account.id}>
                <AccountDetailSheet
                  account={account}
                  allAccounts={accounts}
                  mappings={mappings}
                  availableCards={availableCards}
                />
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}
