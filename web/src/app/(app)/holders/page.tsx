import { CreditCard, Mail } from 'lucide-react';
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
        <ul className="grid gap-3 sm:grid-cols-2">
          {holders.map((h) => {
            const n = counts.get(h.id) ?? 0;
            const initial = h.name.trim().charAt(0).toUpperCase() || '?';
            return (
              <li key={h.id}>
                <Card className="group h-full overflow-hidden border border-border/70 transition-all hover:border-foreground/20 hover:shadow-xs">
                  <CardContent className="flex flex-row items-center justify-between gap-3.5 p-4 sm:p-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3.5">
                      <div
                        aria-hidden
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 text-base font-semibold text-primary shadow-xs"
                      >
                        {initial}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold text-base leading-snug text-foreground">{h.name}</span>
                          {h.active === false && <Badge variant="secondary" className="leading-none text-xs">Inactive</Badge>}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                          {h.email ? (
                            <span className="truncate max-w-[190px] inline-flex items-center gap-1 font-normal">
                              <Mail className="h-3 w-3 opacity-70" aria-hidden />
                              {h.email}
                            </span>
                          ) : null}
                          <Badge variant="secondary" className="gap-1 font-normal text-xs px-2 py-0 h-5">
                            <CreditCard className="h-3 w-3 opacity-70" aria-hidden />
                            {n} {n === 1 ? 'card' : 'cards'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border/50 bg-background/50 p-0.5 sm:pl-1">
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
