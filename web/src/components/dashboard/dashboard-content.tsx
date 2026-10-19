import { cache } from 'react';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import {
  loadDashboardAction,
  loadDashboardExpiringSoonAction,
  loadDashboardLifetimeAction,
  loadDashboardPeriodAction,
  loadDashboardRedeemedValuesAction,
} from '@/actions/instance-queries';
import type { DashboardSummary } from '@/domain/instance-queries';
import type { ViewedPeriod } from '@/lib/periods';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/empty-state';
import { ActionQueueCards } from './action-queue-cards';
import { ErrorPanel } from './error-panel';
import { ExpiringSoon } from './expiring-soon';
import { HolderProgress } from './holder-progress';
import { LifetimeSection } from './lifetime-section';
import { RedeemedValueCards } from './redeemed-value-cards';
import { StatusCounts } from './status-counts';

// Deduplicate period query across sibling server components in the same render pass
const getPeriodData = cache(async (view: ViewedPeriod) => {
  return await loadDashboardPeriodAction(view);
});

export async function ActionQueueSection({ view }: { view: ViewedPeriod }) {
  try {
    const s = await getPeriodData(view);
    if (s.isDeskEmpty) {
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
    return <ActionQueueCards view={view} s={s as unknown as DashboardSummary} />;
  } catch (e) {
    console.error('[ActionQueueSection] failed:', e);
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : String(e);
    return <ErrorPanel message={`Action queue could not be loaded: ${msg}`} />;
  }
}

export async function RedeemedValueSection({ today }: { today: string }) {
  try {
    const s = await loadDashboardRedeemedValuesAction(today);
    return <RedeemedValueCards s={s as unknown as DashboardSummary} today={today} />;
  } catch (e) {
    console.error('[RedeemedValueSection] failed:', e);
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : String(e);
    return <ErrorPanel message={`Redeemed values could not be loaded: ${msg}`} />;
  }
}

export async function StatusCountsSection({ view }: { view: ViewedPeriod }) {
  try {
    const s = await getPeriodData(view);
    if (s.isDeskEmpty) return null;
    return <StatusCounts view={view} s={s as unknown as DashboardSummary} />;
  } catch (e) {
    console.error('[StatusCountsSection] failed:', e);
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : String(e);
    return <ErrorPanel message={`Status breakdown could not be loaded: ${msg}`} />;
  }
}

export async function HolderProgressSection({ view }: { view: ViewedPeriod }) {
  try {
    const s = await getPeriodData(view);
    if (s.isDeskEmpty) return null;
    return <HolderProgress view={view} holders={s.perHolder} />;
  } catch (e) {
    console.error('[HolderProgressSection] failed:', e);
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : String(e);
    return <ErrorPanel message={`Holder progress could not be loaded: ${msg}`} />;
  }
}

export async function ExpiringSoonSection({ today }: { today: string }) {
  try {
    const s = await loadDashboardExpiringSoonAction(today);
    return <ExpiringSoon items={s.expiringSoon} days={s.expiringWithinDays} today={today} />;
  } catch (e) {
    console.error('[ExpiringSoonSection] failed:', e);
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : String(e);
    return <ErrorPanel message={`Expiring vouchers could not be loaded: ${msg}`} />;
  }
}

export async function LifetimeSectionContainer({ today }: { today?: string }) {
  try {
    const s = await loadDashboardLifetimeAction(today);
    return <LifetimeSection s={s as unknown as DashboardSummary} />;
  } catch (e) {
    console.error('[LifetimeSectionContainer] failed:', e);
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : String(e);
    return <ErrorPanel message={`Lifetime summary could not be loaded: ${msg}`} />;
  }
}

/** Full composite dashboard component for backwards compatibility. */
export async function DashboardContent({ view, today }: { view: ViewedPeriod; today: string }) {
  let s: DashboardSummary;
  try {
    s = await loadDashboardAction(view);
  } catch (e) {
    console.error('[DashboardContent] failed to load dashboard:', e);
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : String(e);
    return <ErrorPanel message={`The dashboard could not be loaded: ${msg}`} />;
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
