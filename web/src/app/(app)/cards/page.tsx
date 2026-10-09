import { listBankCardTypes, listCardVariants, listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CardFormSheet } from '@/components/cards/card-form';
import { CurationBadge } from '@/components/cards/curation-badge';
import { DeleteCardButton } from '@/components/cards/delete-card-button';

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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cards</h1>
          <p className="text-sm text-muted-foreground">Each card is an instance of a bank card type, owned by a holder.</p>
        </div>
        <CardFormSheet holders={holderOptions} types={typeOptions} variants={variants} />
      </div>

      {holders.length === 0 && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
          Add a holder first (see Holders); cards belong to a holder.
        </p>
      )}

      {cards.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No cards yet. Add a card to start tracking its benefits.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((c) => {
            const t = typeById.get(c.bankCardTypeId);
            const holder = holderById.get(c.holderId);
            return (
              <li key={c.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.displayName}</span>
                        {c.active === false && <Badge variant="secondary">Inactive</Badge>}
                        {t && <CurationBadge status={t.curationStatus} />}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t ? t.displayName : 'Card type no longer listed'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {holder?.name ?? 'Unknown holder'}
                        {c.lastDigits ? ` · ending ${c.lastDigits}` : ''} · tracking from {c.trackingFrom}
                      </p>
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
    </div>
  );
}
