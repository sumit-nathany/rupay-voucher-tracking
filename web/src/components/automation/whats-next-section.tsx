'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  KeyRound,
  CheckCircle2,
  ArrowRight,
  CreditCard,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PortalAccountView, AttemptView } from '@/domain/automation';
import type { QueueItemView } from '@/domain/ordering-queue';

export type AttentionItem = {
  id: string;
  message: string;
  detail?: string;
  actionLabel: string;
  actionTab?: 'setup' | 'activity';
  actionHref?: string;
};

const ATTENTION_STATUSES: PortalAccountView['status'][] = [
  'needs_attention',
  'credentials_expired',
  'challenge_required',
  'portal_changed',
];

export function buildAttentionItems(
  accounts: PortalAccountView[],
  attempts: AttemptView[],
  hasOtpChannel: boolean,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (accounts.length === 0) {
    items.push({
      id: 'no-accounts',
      message: 'No RuPay portal account configured',
      detail: 'Connect your RuPay portal login to enable automated ordering.',
      actionLabel: 'Configure',
      actionHref: '/accounts',
    });
  }

  for (const acc of accounts) {
    if (ATTENTION_STATUSES.includes(acc.status)) {
      items.push({
        id: `account-${acc.id}`,
        message: `${acc.label} — ${acc.status.replace(/_/g, ' ')}`,
        detail: 'The worker will skip this account until it is fixed.',
        actionLabel: 'Fix',
        actionHref: '/accounts',
      });
    }
  }

  const uncertainCount = attempts.filter((a) => a.state === 'uncertain').length;
  if (uncertainCount > 0) {
    items.push({
      id: 'uncertain-attempts',
      message: `${uncertainCount} uncertain ${uncertainCount === 1 ? 'booking' : 'bookings'} need reconciliation`,
      detail: 'The portal outcome was not confirmed — mark it ordered or not ordered.',
      actionLabel: 'Review',
      actionTab: 'activity',
    });
  }

  if (!hasOtpChannel) {
    items.push({
      id: 'otp-channel',
      message: 'No OTP delivery channel configured',
      detail: 'Bank OTPs during checkout need Telegram to reach you.',
      actionLabel: 'Set up',
      actionTab: 'setup',
    });
  }

  return items;
}

function NextOrderPreview({
  queue,
  onBrowseQueue,
}: {
  queue: QueueItemView[];
  onBrowseQueue?: () => void;
}) {
  const enabled = queue.filter((i) => i.enabled);
  const upcoming = enabled.slice(0, 3);

  if (upcoming.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center bg-muted/10">
        <CheckCircle2 className="h-8 w-8 text-muted-foreground/60 mx-auto mb-2" />
        <p className="text-sm font-semibold text-foreground">Nothing queued to order</p>
        <p className="text-xs text-muted-foreground mt-1">
          Enable vouchers in the queue below to have them ordered automatically.
        </p>
        {onBrowseQueue && (
          <Button variant="outline" size="sm" onClick={onBrowseQueue} className="mt-4 rounded-xl">
            Go to queue <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {upcoming.map((item, idx) => {
        const noAccount = !item.portalAccountLabel;
        const hasOptions = item.availableOptions.length > 0;
        const optionNeeded = hasOptions && !item.chosenOptionId;

        return (
          <div
            key={item.instanceId}
            className={`flex items-center gap-4 rounded-2xl border p-4 ${
              idx === 0
                ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
                : 'border-border/70 bg-card'
            }`}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-bold text-sm ${
                idx === 0 ? 'bg-primary text-primary-foreground shadow-xs' : 'bg-muted text-muted-foreground'
              }`}
            >
              {idx + 1}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-semibold text-sm sm:text-base text-foreground truncate">
                  {item.benefitProvider ? `${item.benefitProvider} - ${item.exactBenefit}` : item.exactBenefit}
                </span>
                {item.cashValue > 0 && (
                  <span className="text-xs sm:text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    ₹{Math.round(item.cashValue)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <CreditCard className="h-3 w-3" />
                  {item.cardName} ••{item.cardLast4}
                </span>
                {item.portalAccountLabel && (
                  <span className="flex items-center gap-1">
                    <KeyRound className="h-3 w-3" />
                    {item.portalAccountLabel}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  expires {item.orderDeadline}
                </span>
                {noAccount && (
                  <Link
                    href="/accounts"
                    className="text-amber-600 dark:text-amber-400 font-medium hover:underline inline-flex items-center gap-0.5"
                  >
                    not mapped to an account
                  </Link>
                )}
                {optionNeeded && (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    benefit choice required
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {enabled.length > upcoming.length && (
        <p className="text-xs text-muted-foreground pl-1">
          + {enabled.length - upcoming.length} more in the queue below
        </p>
      )}
    </div>
  );
}

export function WhatsNextSection({
  attention,
  queue,
  onNavigate,
}: {
  attention: AttentionItem[];
  queue: QueueItemView[];
  onNavigate: (tab: 'setup' | 'activity') => void;
}) {
  return (
    <div className="space-y-8">
      {attention.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Needs attention
          </h3>
          <div className="space-y-2">
            {attention.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">{item.message}</p>
                  {item.detail && (
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  )}
                </div>
                {item.actionHref ? (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-8 rounded-lg text-xs font-semibold gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                  >
                    <Link href={item.actionHref}>
                      {item.actionLabel}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => item.actionTab && onNavigate(item.actionTab)}
                    className="shrink-0 h-8 rounded-lg text-xs font-semibold gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                  >
                    {item.actionLabel}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {attention.length === 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-800 dark:text-emerald-300 font-medium">
            Nothing needs attention. The worker is good to run.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Next orders</h3>
        <NextOrderPreview queue={queue} />
      </div>
    </div>
  );
}
