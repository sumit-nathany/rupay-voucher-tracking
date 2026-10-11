'use client';

import { KeyRound, Sliders, History } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import type { PortalAccountView, PortalCardMappingView, OrderingRuleView, AttemptView } from '@/domain/automation';
import { PortalAccountsSection } from './portal-accounts-section';
import { PortalCardMappingsSection, type CardOption } from './portal-card-mappings-section';
import { OrderingRulesSection } from './ordering-rules-section';
import { AttemptsHistorySection } from './attempts-history-section';

export interface AutomationDashboardProps {
  accounts: PortalAccountView[];
  mappings: PortalCardMappingView[];
  availableCards: CardOption[];
  rules: OrderingRuleView[];
  attempts: AttemptView[];
}

export function AutomationDashboard({
  accounts,
  mappings,
  availableCards,
  rules,
  attempts,
}: AutomationDashboardProps) {
  return (
    <Tabs defaultValue="accounts" className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <TabsList className="bg-muted/60 p-1 h-10 border border-border/70 rounded-xl gap-1 shadow-2xs">
          <TabsTrigger
            value="accounts"
            className="gap-2 px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs rounded-lg transition-all"
          >
            <KeyRound className="h-3.5 w-3.5 text-primary" />
            <span>Accounts & Cards</span>
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] h-4 font-semibold">
              {accounts.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="rules"
            className="gap-2 px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs rounded-lg transition-all"
          >
            <Sliders className="h-3.5 w-3.5 text-primary" />
            <span>Ordering Rules</span>
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] h-4 font-semibold">
              {rules.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="gap-2 px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs rounded-lg transition-all"
          >
            <History className="h-3.5 w-3.5 text-primary" />
            <span>Activity Log</span>
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] h-4 font-semibold">
              {attempts.length}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="accounts" className="space-y-8 pt-1 focus-visible:outline-none">
        <PortalAccountsSection accounts={accounts} />
        <div className="pt-4 border-t border-border/50">
          <PortalCardMappingsSection
            mappings={mappings}
            accounts={accounts}
            availableCards={availableCards}
          />
        </div>
      </TabsContent>

      <TabsContent value="rules" className="pt-1 focus-visible:outline-none">
        <OrderingRulesSection rules={rules} accounts={accounts} />
      </TabsContent>

      <TabsContent value="activity" className="pt-1 focus-visible:outline-none">
        <AttemptsHistorySection attempts={attempts} />
      </TabsContent>
    </Tabs>
  );
}
