import { listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { listOverrides } from '@/actions/overrides';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteOverrideButton, OverrideToggle } from '@/components/overrides/override-actions';
import { OverrideFormSheet } from '@/components/overrides/override-form';
import { ContentStage } from '@/components/layout/content-stage';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { formatCardLabel } from '@/domain/card-label';

export const dynamic = 'force-dynamic';

export default async function OverridesPage() {
  const [overrides, cards, holders] = await Promise.all([listOverrides(), listCards(), listHolders()]);
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

  return (
    <ContentStage className="max-w-3xl">
      <PageHeader
        eyebrow="Personal catalog"
        title="Overrides"
        description="Add or hide benefits for a specific card without changing the shared catalog for everyone."
        actions={<OverrideFormSheet cards={cardOptions} />}
      />

      {overrides.length === 0 ? (
        <EmptyState title="No overrides" description="Your cards follow the shared catalog as-is." />
      ) : (
        <ul className="flex flex-col gap-3">
          {overrides.map((o) => {
            const isAdd = o.kind === 'add';
            const title = isAdd ? (o.exactBenefit ?? 'Added benefit') : 'Hidden catalog benefit';
            return (
              <li key={o.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={isAdd ? 'default' : 'outline'}>{isAdd ? 'Added' : 'Suppressed'}</Badge>
                        <Badge variant={o.active ? 'success' : 'secondary'}>{o.active ? 'On' : 'Off'}</Badge>
                      </div>
                      <p className="break-words font-medium">{title}</p>
                      <p className="text-sm text-muted-foreground">
                        {cardName.get(o.cardId) ?? 'Unknown card'}
                        {isAdd &&
                          ` · ${[o.benefitType, o.benefitProvider].filter(Boolean).join(' / ')} · ${o.instanceCount} per ${o.frequency}`}
                        {isAdd && o.defaultCashValue ? ` · ₹${o.defaultCashValue}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-start gap-2">
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
    </ContentStage>
  );
}
