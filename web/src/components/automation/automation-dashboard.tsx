'use client';

import { KeyRound, CreditCard, ListOrdered, History, BellRing } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import type { PortalAccountView, PortalCardMappingView, OrderingRuleView, AttemptView } from '@/domain/automation';
import type { QueueItemView } from '@/domain/ordering-queue';
import { PortalAccountsSection } from './portal-accounts-section';
import { PortalCardMappingsSection, type CardOption } from './portal-card-mappings-section';
import { OrderQueueSection } from './order-queue-section';
import { AttemptsHistorySection } from './attempts-history-section';
import { OtpChannelsSection } from './otp-channels-section';

export interface AutomationDashboardProps {
  accounts: PortalAccountView[];
  mappings: PortalCardMappingView[];
  availableCards: CardOption[];
  rules: OrderingRuleView[];
  queue: QueueItemView[];
  attempts: AttemptView[];
  whatsappPhoneNumber?: string | null;
  telegramChatId?: string | null;
}

export function AutomationDashboard({
  accounts,
  mappings,
  availableCards,
  queue,
  attempts,
  whatsappPhoneNumber,
  telegramChatId,
}: AutomationDashboardProps) {
  const hasAnyOtpChannel = Boolean(whatsappPhoneNumber || telegramChatId);

  return (
    <Tabs defaultValue={queue.length > 0 ? "queue" : "accounts"} className="space-y-8 sm:space-y-10">
      <div className="flex items-center justify-between gap-4">
        <TabsList className="bg-muted/50 p-1.5 h-auto sm:h-12 rounded-2xl gap-1.5 border border-border/60 flex flex-wrap sm:inline-flex w-full sm:w-auto">
          <TabsTrigger
            value="queue"
            className="gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <ListOrdered className="h-4 w-4 text-muted-foreground" />
            <span>Order Queue</span>
            <Badge variant="secondary" className="ml-1 px-2 py-0 text-xs font-medium">
              {queue.length}
            </Badge>
          </TabsTrigger>

          <TabsTrigger
            value="accounts"
            className="gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span>Accounts</span>
            <Badge variant="secondary" className="ml-1 px-2 py-0 text-xs font-medium">
              {accounts.length}
            </Badge>
          </TabsTrigger>

          <TabsTrigger
            value="mappings"
            className="gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <span>Card Mappings</span>
            <Badge variant="secondary" className="ml-1 px-2 py-0 text-xs font-medium">
              {mappings.length}
            </Badge>
          </TabsTrigger>

          <TabsTrigger
            value="activity"
            className="gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <History className="h-4 w-4 text-muted-foreground" />
            <span>Activity Log</span>
            <Badge variant="secondary" className="ml-1 px-2 py-0 text-xs font-medium">
              {attempts.length}
            </Badge>
          </TabsTrigger>

          <TabsTrigger
            value="channels"
            className="gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <BellRing className="h-4 w-4 text-muted-foreground" />
            <span>OTP Channels</span>
            {hasAnyOtpChannel ? (
              <span className="flex h-2 w-2 rounded-full bg-emerald-500" title="Channel configured" />
            ) : (
              <span className="flex h-2 w-2 rounded-full bg-amber-500" title="No channel configured" />
            )}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="queue" className="mt-8 sm:mt-10 focus-visible:outline-none">
        <OrderQueueSection initialQueue={queue} />
      </TabsContent>

      <TabsContent value="accounts" className="mt-8 sm:mt-10 focus-visible:outline-none">
        <PortalAccountsSection
          accounts={accounts}
          mappings={mappings}
          availableCards={availableCards}
        />
      </TabsContent>

      <TabsContent value="mappings" className="mt-8 sm:mt-10 focus-visible:outline-none">
        <PortalCardMappingsSection
          mappings={mappings}
          accounts={accounts}
          availableCards={availableCards}
        />
      </TabsContent>

      <TabsContent value="activity" className="mt-8 sm:mt-10 focus-visible:outline-none">
        <AttemptsHistorySection attempts={attempts} />
      </TabsContent>

      <TabsContent value="channels" className="mt-8 sm:mt-10 focus-visible:outline-none">
        <OtpChannelsSection
          whatsappPhoneNumber={whatsappPhoneNumber}
          telegramChatId={telegramChatId}
        />
      </TabsContent>
    </Tabs>
  );
}
