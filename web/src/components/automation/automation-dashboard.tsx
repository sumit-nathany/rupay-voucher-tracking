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
  AttentionSection,
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

type TabValue = 'queue' | 'activity' | 'setup';

export function AutomationDashboard({
  accounts,
  mappings,
  availableCards,
  queue,
  attempts: initialAttempts,
  whatsappPhoneNumber,
  telegramChatId,
}: AutomationDashboardProps) {
  const [tab, setTab] = useState<TabValue>('queue');
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

  const enabledCount = queue.filter((i) => i.enabled).length;

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Actionable alerts (only visible when action is required) */}
      <AttentionSection attention={attention} onNavigate={handleNavigate} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="space-y-6 sm:space-y-8">
        <div className="flex items-center justify-between gap-4">
          <TabsList className="bg-muted/50 p-1.5 h-auto sm:h-12 rounded-2xl gap-1.5 border border-border/60 flex flex-wrap sm:inline-flex w-full sm:w-auto">
            <TabsTrigger
              value="queue"
              className="gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl"
            >
              <ListOrdered className="h-4 w-4 text-muted-foreground" />
              <span>Order Queue</span>
              <Badge variant="secondary" className="ml-1 px-2 py-0 text-xs font-semibold">
                {enabledCount}
              </Badge>
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
              <span>Setup & Channels</span>
              <Badge variant="secondary" className="ml-1 px-2 py-0 text-xs font-medium">
                {accounts.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="queue" className="focus-visible:outline-none">
          <OrderQueueSection initialQueue={queue} accounts={accounts} />
        </TabsContent>

        <TabsContent value="activity" className="focus-visible:outline-none">
          <AttemptsHistorySection attempts={attempts} />
        </TabsContent>

        <TabsContent value="setup" className="focus-visible:outline-none">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch max-w-5xl">
            <div className="md:col-span-5 lg:col-span-4 flex flex-col">
              <PortalAccountsSection
                accounts={accounts}
                mappings={mappings}
                availableCards={availableCards}
              />
            </div>

            <div className="md:col-span-7 lg:col-span-8 flex flex-col">
              <OtpChannelsSection
                whatsappPhoneNumber={whatsappPhoneNumber}
                telegramChatId={telegramChatId}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
