import { listBankCardTypes, listCardVariants, listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CardFormSheet } from '@/components/cards/card-form';
import { CurationBadge } from '@/components/cards/curation-badge';
import { DeleteCardButton } from '@/components/cards/delete-card-button';
import { ContentStage } from '@/components/layout/content-stage';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';

export const dynamic = 'force-dynamic';

export default async function CardsPage() {
  const [cards, holders, types, variants] = await Promise.all([
    listCards(),
    listHolders(),
    listBankCardTypes(),
    listCardVariants(),
  ]);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const holderById = new Map(holders.map((h) => [h.id, h]));
  const typeOptions = types.map((t) => ({
    id: t.id,
    displayName: t.displayName,
    variantId: t.variantId,
    active: t.active !== false,
    curationStatus: t.curationStatus,
  }));
  const holderOptions = holders.map((h) => ({ id: h.id, name: h.name }));

  return (
    <ContentStage className="max-w-3xl">
      <PageHeader
        eyebrow="Portfolio"
        title="Cards"
        description="Physical cards linked to catalog types and holders — benefits flow from here."
        actions={<CardFormSheet holders={holderOptions} types={typeOptions} variants={variants} />}
      />

      {holders.length === 0 && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
          Add a holder first (see Holders); cards belong to a holder.
        </p>
      )}

      {cards.length === 0 ? (
        <EmptyState title="No cards yet" description="Add a card to start tracking benefits for that holder." />
      ) : (
        <ul className="flex flex-col gap-4">
          {cards.map((c) => {
            const t = typeById.get(c.bankCardTypeId);
            const holder = holderById.get(c.holderId);
            const initial = (holder?.name ?? '?').charAt(0).toUpperCase();
            return (
              <li key={c.id}>
                <Card className="surface-card-interactive overflow-hidden">
                  <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 gap-4">
                      <span
                        aria-hidden
                        className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-teal/15 font-semibold tracking-tight text-xl text-primary"
                      >
                        {initial}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{c.displayName}</span>
                          {c.active === false && <Badge variant="secondary">Inactive</Badge>}
                          {t && <CurationBadge status={t.curationStatus} />}
                        </div>
                        <p className="text-sm text-muted-foreground">{t ? t.displayName : 'Card type no longer listed'}</p>
                        <p className="text-xs text-muted-foreground">
                          {holder?.name ?? 'Unknown holder'}
                          {c.lastDigits ? ` · ••${c.lastDigits}` : ''} · since {c.trackingFrom}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <CardFormSheet
                        holders={holderOptions}
                        types={typeOptions}
                        variants={variants}
                        card={{
                          id: c.id,
                          holderId: c.holderId,
                          bankCardTypeId: c.bankCardTypeId,
                          displayName: c.displayName,
                          lastDigits: c.lastDigits,
                          trackingFrom: c.trackingFrom,
                          active: c.active ?? true,
                        }}
                      />
                      <DeleteCardButton id={c.id} name={c.displayName} />
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
