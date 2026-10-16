import { listPortalAccountsAction } from '@/actions/automation';
import { AccountDetailSheet } from '@/components/accounts/account-detail-sheet';
import { AccountFormSheet } from '@/components/accounts/account-form-sheet';
import { ContentStage } from '@/components/layout/content-stage';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorPanel } from '@/components/dashboard/error-panel';
import type { PortalAccountView } from '@/domain/automation';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  let accounts: PortalAccountView[] = [];
  try {
    accounts = await listPortalAccountsAction();
  } catch (err) {
    console.error('[AccountsPage]', err);
    return (
      <ContentStage className="max-w-3xl [.nav-unpinned_&]:max-w-4xl">
        <PageHeader
          eyebrow="Accounts"
          title="RuPay Accounts"
          description="RuPay portal accounts used for automated ordering."
          actions={<AccountFormSheet />}
        />
        <ErrorPanel message={err instanceof Error ? err.message : String(err)} />
      </ContentStage>
    );
  }

  return (
    <ContentStage className="max-w-3xl [.nav-unpinned_&]:max-w-4xl">
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
              <AccountDetailSheet account={account} />
            </li>
          ))}
        </ul>
      )}
    </ContentStage>
  );
}