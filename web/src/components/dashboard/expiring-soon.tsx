'use client';
import { benefitLabel } from '@/components/benefits/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { InstanceListItem } from '@/domain/instance-queries';
import { useBenefitDrawer } from '@/components/benefits/use-drawer';
import { formatDate, formatINR } from './format';

function daysLeft(expiry: string, today: string): number {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function ExpiringSoon({ items, days, today }: { items: InstanceListItem[]; days: number; today: string }) {
  const { open, drawer } = useBenefitDrawer();
  return (
    <Card>
      <CardHeader className="pb-3 sm:pb-3">
        <CardTitle className="text-base">Expiring in the next {days} days</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No received coupons are about to expire.</p>
        ) : (
          <ul className="divide-y">
            {items.map((it) => {
              const left = it.expiryDate ? daysLeft(it.expiryDate, today) : null;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => open(it.id, { title: `${it.benefitType}: ${benefitLabel(it)}`, subtitle: `${it.holderName} · ${it.cardName}` })}
                    className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {it.benefitType}: {benefitLabel(it)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {it.holderName} · {it.cardName} · {formatINR(it.value)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className={`block font-medium ${left != null && left <= 7 ? 'text-destructive' : 'text-warning'}`}>
                        {left === 0 ? 'Today' : left === 1 ? '1 day' : `${left} days`}
                      </span>
                      {it.expiryDate && <span className="text-muted-foreground">{formatDate(it.expiryDate)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {drawer}
    </Card>
  );
}
