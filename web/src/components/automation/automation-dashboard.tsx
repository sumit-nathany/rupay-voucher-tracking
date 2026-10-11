'use client';

import { KeyRound, Sliders, History, BellRing } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import type { PortalAccountView, PortalCardMappingView, OrderingRuleView, AttemptView } from '@/domain/automation';
import { PortalAccountsSection } from './portal-accounts-section';
import { PortalCardMappingsSection, type CardOption } from './portal-card-mappings-section';
import { OrderingRulesSection } from './ordering-rules-section';
import { AttemptsHistorySection } from './attempts-history-section';
import { OtpChannelsSection } from './otp-channels-section';

export interface AutomationDashboardProps {
  accounts: PortalAccountView[];
  mappings: PortalCardMappingView[];
  availableCards: CardOption[];
  rules: OrderingRuleView[];
  attempts: AttemptView[];
  whatsappPhoneNumber?: string | null;
  telegramChatId?: string | null;
}

export function AutomationDashboard({
  accounts,
  mappings,
  availableCards,
  rules,
  attempts,
  whatsappPhoneNumber,
  telegramChatId,
}: AutomationDashboardProps) {
  const hasAnyOtpChannel = Boolean(whatsappPhoneNumber || telegramChatId);

  return (
    <Tabs defaultValue="accounts" className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <TabsList className="bg-muted/50 p-1 h-10 rounded-xl gap-1 border border-border/60">
          <TabsTrigger
            value="accounts"
            className="gap-2 px-3.5 py-1.5 text-sm font-medium rounded-lg"
          >
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span>Accounts & Cards</span>
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-xs font-medium">
              {accounts.length}
            </Badge>
          </TabsTrigger>

          <TabsTrigger
            value="rules"
            className="gap-2 px-3.5 py-1.5 text-sm font-medium rounded-lg"
          >
            <Sliders className="h-4 w-4 text-muted-foreground" />
            <span>Ordering Rules</span>
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-xs font-medium">
              {rules.length}
            </Badge>
          </TabsTrigger>

          <TabsTrigger
            value="activity"
            className="gap-2 px-3.5 py-1.5 text-sm font-medium rounded-lg"
          >
            <History className="h-4 w-4 text-muted-foreground" />
            <span>Activity Log</span>
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-xs font-medium">
              {attempts.length}
            </Badge>
          </TabsTrigger>

          <TabsTrigger
            value="channels"
            className="gap-2 px-3.5 py-1.5 text-sm font-medium rounded-lg"
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

      <TabsContent value="accounts" className="space-y-8 pt-1 focus-visible:outline-none">
        <PortalAccountsSection
          accounts={accounts}
          mappings={mappings}
          availableCards={availableCards}
        />
        <PortalCardMappingsSection
          mappings={mappings}
          accounts={accounts}
          availableCards={availableCards}
        />
      </TabsContent>

      <TabsContent value="rules" className="pt-1 focus-visible:outline-none">
        <OrderingRulesSection rules={rules} accounts={accounts} />
      </TabsContent>

      <TabsContent value="activity" className="pt-1 focus-visible:outline-none">
        <AttemptsHistorySection attempts={attempts} />
      </TabsContent>

      <TabsContent value="channels" className="pt-1 focus-visible:outline-none">
        <OtpChannelsSection
          whatsappPhoneNumber={whatsappPhoneNumber}
          telegramChatId={telegramChatId}
        />
      </TabsContent>
    </Tabs>
  );
}
