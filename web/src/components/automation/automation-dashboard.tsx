'use client';

import { useState, useMemo } from 'react';
import { ListOrdered, KeyRound, History } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import type { PortalAccountView, PortalCardMappingView, AttemptView } from '@/domain/automation';
import type { QueueItemView } from '@/domain/ordering-queue';
import type { CardOption } from './mapping-dialogs';
import { PortalAccountsSection } from './portal-accounts-section';
import { OrderQueueSection } from './order-queue-section';
import { AttemptsHistorySection } from './attempts-history-section';
import { OtpChannelsSection } from './otp-channels-section';
import {
  WhatsNextSection,
  buildAttentionItems,
  type AttentionItem,
} from './whats-next-section';

export interface AutomationDashboardProps {
  accounts: PortalAccountView[];
  mappings: PortalCardMappingView[];
  availableCards: CardOption[];
  queue: QueueItemView[];
  attempts: AttemptView[];
  whatsappPhoneNumber?: string | null;
  telegramChatId?: string | null;
}

type TabValue = 'whats-next' | 'activity' | 'setup';

export function AutomationDashboard({
  accounts,
  mappings,
  availableCards,
  queue,
  attempts: initialAttempts,
  whatsappPhoneNumber,
  telegramChatId,
}: AutomationDashboardProps) {
  const [tab, setTab] = useState<TabValue>('whats-next');
  const hasAnyOtpChannel = Boolean(telegramChatId);

  const attention: AttentionItem[] = useMemo(
    () => buildAttentionItems(accounts, initialAttempts, hasAnyOtpChannel),
    [accounts, initialAttempts, hasAnyOtpChannel],
  );

  // Uncertain outcomes demand action — always sort them to the top.
  const attempts = useMemo(
    () =>
      [...initialAttempts].sort((a, b) => {
        const aUncertain = a.state === 'uncertain' ? 0 : 1;
        const bUncertain = b.state === 'uncertain' ? 0 : 1;
        return aUncertain - bUncertain;
      }),
    [initialAttempts],
  );

  const uncertainCount = attempts.filter((a) => a.state === 'uncertain').length;

  function handleNavigate(target: 'setup' | 'activity') {
    setTab(target);
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="space-y-8 sm:space-y-10">
      <div className="flex items-center justify-between gap-4">
        <TabsList className="bg-muted/50 p-1.5 h-auto sm:h-12 rounded-2xl gap-1.5 border border-border/60 flex flex-wrap sm:inline-flex w-full sm:w-auto">
          <TabsTrigger
            value="whats-next"
            className="gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <ListOrdered className="h-4 w-4 text-muted-foreground" />
            <span>What&apos;s Next</span>
            {attention.length > 0 && (
              <Badge variant="destructive" className="ml-1 px-2 py-0 text-xs font-medium">
                {attention.length}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="activity"
            className="gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <History className="h-4 w-4 text-muted-foreground" />
            <span>Activity</span>
            {uncertainCount > 0 ? (
              <Badge variant="destructive" className="ml-1 px-2 py-0 text-xs font-medium">
                {uncertainCount}
              </Badge>
            ) : (
              <Badge variant="secondary" className="ml-1 px-2 py-0 text-xs font-medium">
                {attempts.length}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="setup"
            className="gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span>Setup</span>
            <Badge variant="secondary" className="ml-1 px-2 py-0 text-xs font-medium">
              {accounts.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="whats-next" className="mt-8 sm:mt-10 focus-visible:outline-none space-y-10 sm:space-y-12">
        <WhatsNextSection
          attention={attention}
          queue={queue}
          onNavigate={handleNavigate}
        />

        <OrderQueueSection initialQueue={queue} accounts={accounts} />
      </TabsContent>

      <TabsContent value="activity" className="mt-8 sm:mt-10 focus-visible:outline-none">
        <AttemptsHistorySection attempts={attempts} />
      </TabsContent>

      <TabsContent value="setup" className="mt-8 sm:mt-10 focus-visible:outline-none space-y-10 sm:space-y-12">
        <PortalAccountsSection
          accounts={accounts}
          mappings={mappings}
          availableCards={availableCards}
        />

        <OtpChannelsSection
          whatsappPhoneNumber={whatsappPhoneNumber}
          telegramChatId={telegramChatId}
        />
      </TabsContent>
    </Tabs>
  );
}
