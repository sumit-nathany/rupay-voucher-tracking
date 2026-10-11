import { ContentStage } from '@/components/layout/content-stage';
import { getAutomationDashboardAction } from '@/actions/automation';
import { listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { AutomationHeader } from '@/components/automation/automation-header';
import { AutomationDashboard } from '@/components/automation/automation-dashboard';

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
    dashboard.accounts.some(
      (a) =>
        a.status === 'needs_attention' ||
        a.status === 'credentials_expired' ||
        a.status === 'challenge_required',
    ) || dashboard.attempts.some((att) => att.state === 'uncertain');

  return (
    <ContentStage className="max-w-5xl space-y-8 sm:space-y-10 p-6 sm:p-10 [.nav-unpinned_&]:max-w-6xl [.nav-unpinned_&]:2xl:max-w-7xl">
      <AutomationHeader
        enabled={dashboard.settings.enabled}
        hasAttentionAccounts={hasAttentionAccounts}
        nextRun={dashboard.nextRun}
      />

      <AutomationDashboard
        accounts={dashboard.accounts}
        mappings={dashboard.mappings}
        availableCards={availableCards}
        rules={dashboard.rules}
        attempts={dashboard.attempts}
        whatsappPhoneNumber={dashboard.settings.whatsappPhoneNumber}
        telegramChatId={dashboard.settings.telegramChatId}
      />
    </ContentStage>
  );
}
