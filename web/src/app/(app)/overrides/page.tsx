import { listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { listOverrides } from '@/actions/overrides';
import {
  listBenefitValueOverridesAction,
  listDistinctWorkspaceBenefitsAction,
} from '@/actions/benefit-values';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DeleteOverrideButton, OverrideToggle } from '@/components/overrides/override-actions';
import { OverrideFormSheet } from '@/components/overrides/override-form';
import { DeleteBenefitValueButton } from '@/components/overrides/benefit-value-actions';
import { BenefitValueFormSheet } from '@/components/overrides/benefit-value-form';
import { ContentStage } from '@/components/layout/content-stage';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { formatCardLabel } from '@/domain/card-label';

export const dynamic = 'force-dynamic';

export default async function OverridesPage() {
  const [overrides, cards, holders, benefitValues, distinctBenefits] = await Promise.all([
    listOverrides(),
    listCards(),
    listHolders(),
    listBenefitValueOverridesAction(),
    listDistinctWorkspaceBenefitsAction(),
  ]);

  const holderById = new Map(holders.map((h) => [h.id, h.name]));
  const cardName = new Map(
    cards.map((c) => [
      c.id,
      formatCardLabel({
        holderName: holderById.get(c.holderId),
        cardName: c.displayName,
        lastDigits: c.lastDigits,
      }),
    ]),
  );
  const cardOptions = cards.map((c) => ({
    id: c.id,
    name: formatCardLabel({
      holderName: holderById.get(c.holderId),
      cardName: c.displayName,
      lastDigits: c.lastDigits,
    }),
  }));

  const distinctByName = new Map(
    distinctBenefits.map((b) => [b.benefitName.toLowerCase().trim(), b]),
  );

  return (
    <ContentStage className="max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Personal catalog"
        title="Overrides & Valuations"
        description="Customize benefit values across all your cards, or add and hide benefits for a specific card."
      />

      <Tabs defaultValue="values" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-sm sm:max-w-md">
          <TabsTrigger value="values" className="text-xs sm:text-sm">
            Benefit Values ({benefitValues.length})
          </TabsTrigger>
          <TabsTrigger value="cards" className="text-xs sm:text-sm">
            Card Benefits ({overrides.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Workspace-wide Benefit Valuations ── */}
        <TabsContent value="values" className="space-y-6 outline-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Define your own valuation for benefits. This custom value will replace RuPay’s catalog nominal face value across all your cards in dashboard totals and queues.
            </p>
            <div className="shrink-0">
              <BenefitValueFormSheet distinctBenefits={distinctBenefits} />
            </div>
          </div>

          {benefitValues.length === 0 ? (
            <EmptyState
              title="No custom benefit values"
              description="All benefits currently follow RuPay's nominal catalog values. Click 'Set Custom Value' to define your own valuation for any benefit."
            />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {benefitValues.map((v) => {
                const info = distinctByName.get(v.benefitName.toLowerCase().trim());
                const catalogVal = info?.catalogValue;

                return (
                  <li key={v.id}>
                    <Card className="hover:border-border transition-colors h-full">
                      <CardContent className="flex flex-col justify-between gap-4 p-5 h-full">
                        <div className="min-w-0 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="default" className="font-normal text-xs">
                              Custom Valuation
                            </Badge>
                            <span className="text-base font-semibold text-foreground">
                              ₹{v.customValue.toFixed(2)}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-base text-foreground break-words">{v.benefitName}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[v.benefitType ?? info?.benefitType, v.benefitProvider ?? info?.benefitProvider]
                                .filter(Boolean)
                                .join(' · ')}
                              {catalogVal != null ? ` · RuPay Catalog: ₹${catalogVal}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/40">
                          <BenefitValueFormSheet override={v} distinctBenefits={distinctBenefits} />
                          <DeleteBenefitValueButton id={v.id} name={v.benefitName} />
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        {/* ── Tab 2: Card Specific Overrides (Add / Suppress) ── */}
        <TabsContent value="cards" className="space-y-6 outline-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              Add or hide benefits for a specific card without changing the shared catalog for everyone.
            </p>
            <div className="shrink-0">
              <OverrideFormSheet cards={cardOptions} />
            </div>
          </div>

          {overrides.length === 0 ? (
            <EmptyState
              title="No card overrides"
              description="Your cards follow the shared catalog as-is."
            />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {overrides.map((o) => {
                const isAdd = o.kind === 'add';
                const title = isAdd ? (o.exactBenefit ?? 'Added benefit') : 'Hidden catalog benefit';
                return (
                  <li key={o.id}>
                    <Card className="hover:border-border transition-colors h-full">
                      <CardContent className="flex flex-col justify-between gap-4 p-5 h-full">
                        <div className="min-w-0 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <Badge variant={isAdd ? 'default' : 'outline'}>{isAdd ? 'Added' : 'Suppressed'}</Badge>
                              <Badge variant={o.active ? 'success' : 'secondary'}>{o.active ? 'On' : 'Off'}</Badge>
                            </div>
                            {isAdd && o.defaultCashValue ? (
                              <span className="text-sm font-semibold text-foreground">
                                ₹{o.defaultCashValue}
                              </span>
                            ) : null}
                          </div>
                          <div>
                            <p className="font-medium text-base text-foreground break-words">{title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {cardName.get(o.cardId) ?? 'Unknown card'}
                              {isAdd &&
                                ` · ${[o.benefitType, o.benefitProvider].filter(Boolean).join(' / ')} · ${o.instanceCount} per ${o.frequency}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/40">
                          <OverrideToggle id={o.id} active={o.active} label={title} />
                          {isAdd && (
                            <OverrideFormSheet
                              cards={cardOptions}
                              override={{
                                id: o.id,
                                kind: o.kind,
                                benefitType: o.benefitType,
                                benefitProvider: o.benefitProvider,
                                exactBenefit: o.exactBenefit,
                                frequency: o.frequency,
                                instanceCount: o.instanceCount,
                                defaultCashValue: o.defaultCashValue,
                              }}
                            />
                          )}
                          <DeleteOverrideButton id={o.id} name={title} />
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </ContentStage>
  );
}
