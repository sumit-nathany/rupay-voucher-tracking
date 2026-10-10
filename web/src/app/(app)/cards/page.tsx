import { listBankCardTypes, listCardVariants, listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { CardDetailSheet } from '@/components/cards/card-detail-sheet';
import { CardFormSheet } from '@/components/cards/card-form';
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
  const variantById = new Map(variants.map((v) => [v.id, v]));

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
        <ul className="flex flex-col gap-3">
          {cards.map((c) => {
            const t = typeById.get(c.bankCardTypeId);
            const holder = holderById.get(c.holderId);
            const v = t?.variantId ? variantById.get(t.variantId) : undefined;
            return (
              <li key={c.id}>
                <CardDetailSheet
                  card={{
                    id: c.id,
                    holderId: c.holderId,
                    bankCardTypeId: c.bankCardTypeId,
                    displayName: c.displayName,
                    lastDigits: c.lastDigits,
                    trackingFrom: c.trackingFrom,
                    active: c.active ?? true,
                    inactiveFrom: c.inactiveFrom,
                  }}
                  holder={holder ? { id: holder.id, name: holder.name } : undefined}
                  bankCardType={
                    t
                      ? {
                          id: t.id,
                          displayName: t.displayName,
                          variantId: t.variantId,
                          active: t.active !== false,
                          curationStatus: t.curationStatus,
                        }
                      : undefined
                  }
                  variant={v ? { id: v.id, name: v.name } : undefined}
                  holders={holderOptions}
                  variants={variants}
                />
              </li>
            );
          })}
        </ul>
      )}
    </ContentStage>
  );
}
