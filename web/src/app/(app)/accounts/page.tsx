import { listPortalAccountsAction, listPortalCardMappingsAction } from '@/actions/automation';
import { listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { AccountsView } from '@/components/accounts/accounts-view';
import { AccountFormSheet } from '@/components/accounts/account-form-sheet';
import { ContentStage } from '@/components/layout/content-stage';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorPanel } from '@/components/dashboard/error-panel';
import type { PortalAccountView, PortalCardMappingView } from '@/domain/automation';
import type { CardOption } from '@/components/automation/mapping-dialogs';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  let accounts: PortalAccountView[] = [];
  let mappings: PortalCardMappingView[] = [];
  let availableCards: CardOption[] = [];

  try {
    const [fetchedAccounts, fetchedMappings, rawCards, holders] = await Promise.all([
      listPortalAccountsAction(),
      listPortalCardMappingsAction(),
      listCards(),
      listHolders(),
    ]);

    accounts = fetchedAccounts;
    mappings = fetchedMappings;

    const holderMap = new Map(holders.map((h) => [h.id, h.name]));
    const cardsWithMappingDetails = new Set(
      mappings
        .filter((m) => {
          if (!m.paymentDetails) return false;
          return m.paymentDetails.mode === 'saved_card'
            ? m.paymentDetails.hasCvv
            : Boolean(m.paymentDetails.maskedCardNumber && m.paymentDetails.hasCvv && m.paymentDetails.expirySummary);
        })
        .map((m) => m.cardId),
    );

    availableCards = rawCards.map((c) => {
      const directValid = Boolean(
        c.paymentSummary &&
          (c.paymentSummary.mode === 'saved_card'
            ? c.paymentSummary.hasCvv
            : c.paymentSummary.maskedCardNumber && c.paymentSummary.hasCvv && c.paymentSummary.expirySummary),
      );
      const mappingValid = cardsWithMappingDetails.has(c.id);
      return {
        id: c.id,
        name: c.displayName,
        holderName: holderMap.get(c.holderId) ?? 'Unknown',
        lastDigits: c.lastDigits,
        hasPaymentDetails: directValid || mappingValid,
      };
    });
  } catch (err) {
    console.error('[AccountsPage]', err);
    return (
      <ContentStage className="max-w-6xl space-y-6 [.nav-unpinned_&]:max-w-7xl [.nav-unpinned_&]:2xl:max-w-[1536px]">
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
    <ContentStage className="max-w-6xl space-y-6 [.nav-unpinned_&]:max-w-7xl [.nav-unpinned_&]:2xl:max-w-[1536px]">
      <PageHeader
        eyebrow="Accounts"
        title="RuPay Accounts"
        description="RuPay portal accounts used for automated ordering."
        actions={<AccountFormSheet />}
      />

      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet" description="Add a RuPay portal account to enable automated ordering." />
      ) : (
        <AccountsView
          accounts={accounts}
          mappings={mappings}
          availableCards={availableCards}
        />
      )}
    </ContentStage>
  );
}