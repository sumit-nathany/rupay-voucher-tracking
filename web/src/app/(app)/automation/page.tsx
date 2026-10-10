import { ContentStage } from '@/components/layout/content-stage';
import { getAutomationDashboardAction } from '@/actions/automation';
import { listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { AutomationHeader } from '@/components/automation/automation-header';
import { PortalAccountsSection } from '@/components/automation/portal-accounts-section';
import { PortalCardMappingsSection } from '@/components/automation/portal-card-mappings-section';
import { OrderingRulesSection } from '@/components/automation/ordering-rules-section';
import { AttemptsHistorySection } from '@/components/automation/attempts-history-section';

export const dynamic = 'force-dynamic';

export default async function AutomationPage() {

  const [dashboard, rawCards, holders] = await Promise.all([
    getAutomationDashboardAction(),
    listCards(),
    listHolders(),
  ]);

  const holderMap = new Map(holders.map((h) => [h.id, h.name]));
  const availableCards = rawCards.map((c) => ({
    id: c.id,
    name: c.displayName,
    holderName: holderMap.get(c.holderId) ?? 'Unknown',
    lastDigits: c.lastDigits,
  }));

  const hasAttentionAccounts =
    dashboard.accounts.some((a) => a.status === 'needs_attention' || a.status === 'credentials_expired' || a.status === 'challenge_required') ||
    dashboard.attempts.some((att) => att.state === 'uncertain');

  return (
    <ContentStage className="max-w-5xl space-y-8 py-6">
      <AutomationHeader
        enabled={dashboard.settings.enabled}
        updatedAt={dashboard.settings.updatedAt}
        hasAttentionAccounts={hasAttentionAccounts}
      />

      <PortalAccountsSection accounts={dashboard.accounts} />

      <PortalCardMappingsSection
        mappings={dashboard.mappings}
        accounts={dashboard.accounts}
        availableCards={availableCards}
      />

      <OrderingRulesSection
        rules={dashboard.rules}
        accounts={dashboard.accounts}
      />

      <AttemptsHistorySection attempts={dashboard.attempts} />
    </ContentStage>
  );
}
