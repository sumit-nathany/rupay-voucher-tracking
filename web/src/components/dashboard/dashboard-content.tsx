import { unstable_rethrow } from 'next/navigation';
import { loadDashboardAction } from '@/actions/instance-queries';
import type { ViewedPeriod } from '@/lib/periods';
import { ErrorPanel } from './error-panel';
import { ExpiringSoon } from './expiring-soon';
import { HolderProgress } from './holder-progress';
import { StatCards } from './stat-cards';
import { StatusCounts } from './status-counts';

export async function DashboardContent({ view, today }: { view: ViewedPeriod; today: string }) {
  let s;
  try {
    s = await loadDashboardAction(view);
  } catch (e) {
    unstable_rethrow(e); // keep auth redirects / framework signals working
    return <ErrorPanel message="The dashboard could not be loaded." />;
  }

  if (s.counts && Object.values(s.counts).every((n) => n === 0) && s.expiringSoon.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">No benefits to track in this period</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a card holder and a card from the Cards page; benefits appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatCards s={s} />
      <div className="grid gap-4 lg:grid-cols-2">
        <StatusCounts s={s} />
        <HolderProgress holders={s.perHolder} />
      </div>
      <ExpiringSoon items={s.expiringSoon} days={s.expiringWithinDays} today={today} />
    </div>
  );
}
