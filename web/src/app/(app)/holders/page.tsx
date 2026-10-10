import { listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteHolderButton } from '@/components/holders/delete-holder-button';
import { HolderFormSheet } from '@/components/holders/holder-form';
import { ContentStage } from '@/components/layout/content-stage';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';

export const dynamic = 'force-dynamic';

export default async function HoldersPage() {
  const [holders, cards] = await Promise.all([listHolders(), listCards()]);
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.holderId, (counts.get(c.holderId) ?? 0) + 1);

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
        <ul className="grid gap-4 sm:grid-cols-2">
          {holders.map((h) => {
            const n = counts.get(h.id) ?? 0;
            const initial = h.name.trim().charAt(0).toUpperCase() || '?';
            return (
              <li key={h.id}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="flex flex-row items-center justify-between gap-4 p-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        aria-hidden
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-base font-semibold text-primary"
                      >
                        {initial}
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold leading-snug">{h.name}</span>
                          {h.active === false && <Badge variant="secondary">Inactive</Badge>}
                        </div>
                        <p className="truncate text-sm text-muted-foreground">{h.email ?? 'No email'}</p>
                        <p className="text-xs text-muted-foreground">{n} card{n === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 sm:pl-2">
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
    </ContentStage>
  );
}
