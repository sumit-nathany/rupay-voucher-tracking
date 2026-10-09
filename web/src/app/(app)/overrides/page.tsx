import { listCards } from '@/actions/cards';
import { listOverrides } from '@/actions/overrides';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteOverrideButton, OverrideToggle } from '@/components/overrides/override-actions';
import { OverrideFormSheet } from '@/components/overrides/override-form';

export const dynamic = 'force-dynamic';

export default async function OverridesPage() {
  const [overrides, cards] = await Promise.all([listOverrides(), listCards()]);
  const cardName = new Map(cards.map((c) => [c.id, c.displayName]));
  const cardOptions = cards.map((c) => ({ id: c.id, name: c.displayName }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Catalog overrides</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            An override corrects the shared catalog for one of your cards only: add a benefit the catalog is missing,
            or hide one it wrongly lists. It stays on until you turn it off.
          </p>
        </div>
        <OverrideFormSheet cards={cardOptions} />
      </div>

      {overrides.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No overrides. Your cards use the shared catalog as it is.
          </CardContent>
        </Card>
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
    </div>
  );
}
