import { listBankCardTypes, listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { HolderDetailSheet } from '@/components/holders/holder-detail-sheet';
import { HolderFormSheet } from '@/components/holders/holder-form';
import { ContentStage } from '@/components/layout/content-stage';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';

export const dynamic = 'force-dynamic';

export default async function HoldersPage() {
  const [holders, cards, types] = await Promise.all([
    listHolders(),
    listCards(),
    listBankCardTypes(),
  ]);

  const typeNameById = new Map(types.map((t) => [t.id, t.displayName]));

  const cardsByHolder = new Map<string, Array<{
    id: string;
    displayName: string;
    lastDigits: string | null;
    bankCardTypeName: string;
    trackingFrom: string;
    active: boolean;
  }>>();

  for (const c of cards) {
    const list = cardsByHolder.get(c.holderId) ?? [];
    list.push({
      id: c.id,
      displayName: c.displayName,
      lastDigits: c.lastDigits,
      bankCardTypeName: typeNameById.get(c.bankCardTypeId) ?? 'Card',
      trackingFrom: c.trackingFrom,
      active: c.active ?? true,
    });
    cardsByHolder.set(c.holderId, list);
  }

  return (
    <ContentStage className="max-w-3xl">
      <PageHeader
        eyebrow="People"
        title="Holders"
        description="Labels for who holds each card — family, friends, or yourself."
        actions={<HolderFormSheet />}
      />

      {holders.length === 0 ? (
        <EmptyState title="No holders yet" description="Add yourself or a family member, then attach cards." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {holders.map((h) => {
            const holderCards = cardsByHolder.get(h.id) ?? [];
            return (
              <li key={h.id}>
                <HolderDetailSheet
                  holder={{ id: h.id, name: h.name, email: h.email, active: h.active ?? true }}
                  cards={holderCards}
                />
              </li>
            );
          })}
        </ul>
      )}
    </ContentStage>
  );
}
