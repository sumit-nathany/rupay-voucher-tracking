import { listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteHolderButton } from '@/components/holders/delete-holder-button';
import { HolderFormSheet } from '@/components/holders/holder-form';

export const dynamic = 'force-dynamic';

export default async function HoldersPage() {
  const [holders, cards] = await Promise.all([listHolders(), listCards()]);
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.holderId, (counts.get(c.holderId) ?? 0) + 1);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Holders</h1>
          <p className="text-sm text-muted-foreground">The people whose cards you track.</p>
        </div>
        <HolderFormSheet />
      </div>

      {holders.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No holders yet. Add yourself or a family member to start adding cards.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {holders.map((h) => {
            const n = counts.get(h.id) ?? 0;
            return (
              <li key={h.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{h.name}</span>
                        {h.active === false && <Badge variant="secondary">Inactive</Badge>}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        {h.email ?? 'No email'} · {n} card{n === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <HolderFormSheet holder={{ id: h.id, name: h.name, email: h.email, active: h.active ?? true }} />
                      <DeleteHolderButton id={h.id} name={h.name} cardCount={n} />
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
