'use client';
import { AlarmClock } from 'lucide-react';
import { benefitLabel } from '@/components/benefits/label';
import type { InstanceListItem } from '@/domain/instance-queries';
import { useBenefitDrawer } from '@/components/benefits/use-drawer';
import { formatDate, formatINR } from './format';

function daysLeft(expiry: string, today: string): number {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function ExpiringSoon({ items, days, today }: { items: InstanceListItem[]; days: number; today: string }) {
  const { open, drawer } = useBenefitDrawer();
  return (
    <section className="panel">
      <div className="panel-header flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold tracking-tight text-lg">Expiring soon</h2>
          <p className="text-xs text-muted-foreground">Coupons to use in the next {days} days</p>
        </div>
        <AlarmClock className="h-5 w-5 text-warning" aria-hidden />
      </div>
      <div className="panel-body">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No received coupons are about to expire. You&apos;re clear.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((it) => {
              const left = it.expiryDate ? daysLeft(it.expiryDate, today) : null;
              const urgent = left != null && left <= 7;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() =>
                      open(it.id, {
                        title: `${it.benefitType}: ${benefitLabel(it)}`,
                        subtitle: `${it.holderName} · ${it.cardName}`,
                      })
                    }
                    className="benefit-card flex w-full flex-col gap-2 p-4 text-left transition-transform active:scale-[0.99]"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{it.benefitType}</span>
                    <span className="line-clamp-2 font-medium leading-snug">{benefitLabel(it)}</span>
                    <span className="text-xs text-muted-foreground">
                      {it.holderName} · {formatINR(it.value)}
                    </span>
                    <span
                      className={`mt-1 inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        urgent ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning'
                      }`}
                    >
                      {left === 0 ? 'Expires today' : left === 1 ? '1 day left' : `${left} days left`}
                      {it.expiryDate && ` · ${formatDate(it.expiryDate)}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {drawer}
    </section>
  );
}
