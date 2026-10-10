import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { loadDashboardAction } from '@/actions/instance-queries';
import type { ViewedPeriod } from '@/lib/periods';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/empty-state';
import { ErrorPanel } from './error-panel';
import { ExpiringSoon } from './expiring-soon';
import { HolderProgress } from './holder-progress';
import { ActionQueueCards } from './action-queue-cards';
import { LifetimeSection } from './lifetime-section';
import { RedeemedValueCards } from './redeemed-value-cards';
import { StatusCounts } from './status-counts';

export async function DashboardContent({ view, today }: { view: ViewedPeriod; today: string }) {
  let s;
  try {
    s = await loadDashboardAction(view);
  } catch (e) {
    unstable_rethrow(e);
    return <ErrorPanel message="The dashboard could not be loaded." />;
  }

  if (s.counts && Object.values(s.counts).every((n) => n === 0) && s.expiringSoon.length === 0) {
    return (
      <EmptyState
        title="Your desk is empty"
        description="Add a holder and a card from the Cards page. Benefits for the period you selected will show up here automatically."
        action={
          <Button asChild>
            <Link href="/cards">Add your first card</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <ActionQueueCards view={view} s={s} />
      <RedeemedValueCards s={s} today={today} />
      <div className="grid gap-4 lg:grid-cols-2">
        <StatusCounts view={view} s={s} />
        <HolderProgress view={view} holders={s.perHolder} />
      </div>
      <ExpiringSoon items={s.expiringSoon} days={s.expiringWithinDays} today={today} />
      <LifetimeSection s={s} />
    </div>
  );
}
