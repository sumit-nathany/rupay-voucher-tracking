import { listPortalAccountsAction } from '@/actions/automation';
import { AccountDetailSheet } from '@/components/accounts/account-detail-sheet';
import { AccountFormSheet } from '@/components/accounts/account-form-sheet';
import { ContentStage } from '@/components/layout/content-stage';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import type { PortalAccountView } from '@/domain/automation';

export const dynamic = 'force-dynamic';

import { listPortalAccountsAction } from '@/actions/automation';
import { AccountDetailSheet } from '@/components/accounts/account-detail-sheet';
import { AccountFormSheet } from '@/components/accounts/account-form-sheet';
import { ContentStage } from '@/components/layout/content-stage';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import type { PortalAccountView } from '@/domain/automation';
import { getCtx } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  let accounts: PortalAccountView[] = [];
  let error: string | null = null;
  let ctxInfo: string | null = null;
  try {
    const ctx = await getCtx();
    ctxInfo = `userId: ${ctx.userId}, workspaceId: ${ctx.workspaceId}`;
    accounts = await listPortalAccountsAction();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error('Accounts page error:', err);
  }

  return (
    <ContentStage className="max-w-3xl [.nav-unpinned_&]:max-w-4xl">
      {ctxInfo && (
        <div className="p-4 mb-4 rounded-md bg-primary/10 text-primary">
          Debug: {ctxInfo}
        </div>
      )}
      {error && (
        <div className="p-4 mb-4 rounded-md bg-destructive/10 text-destructive">
          Error loading accounts: {error}
        </div>
      )}
      <PageHeader
        eyebrow="Accounts"
        title="RuPay Accounts"
        description="RuPay portal accounts used for automated ordering."
        actions={<AccountFormSheet />}
      />

      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet" description="Add a RuPay portal account to enable automated ordering." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {accounts.map((account: PortalAccountView) => (
            <li key={account.id}>
              <AccountDetailSheet
                account={{
                  id: account.id,
                  label: account.label,
                  phoneNumber: account.phoneNumber,
                  status: account.status,
                  hasCredentials: account.hasCredentials,
                  lastConfirmedOrderAt: account.lastConfirmedOrderAt,
                  lastCheckedAt: account.lastCheckedAt,
                  statusDetailCode: account.statusDetailCode,
                  cooldownUntil: account.cooldownUntil,
                  createdAt: account.createdAt,
                  updatedAt: account.updatedAt,
                  mappingsCount: account.mappingsCount,
                  rulesCount: account.rulesCount,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </ContentStage>
  );
}