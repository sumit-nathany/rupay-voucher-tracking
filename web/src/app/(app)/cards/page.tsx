import { Calendar, CreditCard } from 'lucide-react';
import { listBankCardTypes, listCardVariants, listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CardFormSheet } from '@/components/cards/card-form';
import { CurationBadge } from '@/components/cards/curation-badge';
import { DeleteCardButton } from '@/components/cards/delete-card-button';
import { formatCardLabel } from '@/domain/card-label';
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
        <ul className="flex flex-col gap-3">
          {cards.map((c) => {
            const t = typeById.get(c.bankCardTypeId);
            const holder = holderById.get(c.holderId);
            return (
              <li key={c.id}>
                <Card className="group overflow-hidden border border-border/70 transition-all hover:border-foreground/20 hover:shadow-xs">
                  <CardContent className="flex items-center justify-between gap-4 p-4 sm:p-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3.5 sm:gap-4">
                      <div
                        aria-hidden
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 text-primary shadow-xs"
                      >
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-base leading-snug text-foreground">
                            {formatCardLabel({ holderName: holder?.name, cardName: c.displayName, lastDigits: c.lastDigits })}
                          </span>
                          {c.active === false && <Badge variant="secondary" className="leading-none text-xs">Inactive</Badge>}
                          {t && <CurationBadge status={t.curationStatus} />}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {t && t.displayName !== c.displayName && (
                            <span className="truncate max-w-[280px] font-normal">{t.displayName}</span>
                          )}
                          {!t && <span className="font-normal">Card type no longer listed</span>}
                          <span className="inline-flex items-center gap-1 font-normal">
                            <Calendar className="h-3 w-3 opacity-70" aria-hidden />
                            since {c.trackingFrom}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border/50 bg-background/50 p-0.5">
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
                      <DeleteCardButton
                        id={c.id}
                        name={formatCardLabel({ holderName: holder?.name, cardName: c.displayName, lastDigits: c.lastDigits })}
                      />
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
