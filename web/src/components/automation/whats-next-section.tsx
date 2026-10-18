'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PortalAccountView, AttemptView } from '@/domain/automation';
import { getPortalStatusExplanation } from '@/lib/portal-status';


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
        detail: getPortalStatusExplanation(acc.status, acc.statusDetailCode),
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

export function AttentionSection({
  attention,
  onNavigate,
}: {
  attention: AttentionItem[];
  onNavigate: (tab: 'setup' | 'activity') => void;
}) {
  if (attention.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5 space-y-3 shadow-xs">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{attention.length} {attention.length === 1 ? 'action required' : 'actions required'}</span>
      </div>
      <div className="grid gap-2">
        {attention.map((item) => (
          <div
            key={item.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card/90 rounded-xl px-4 py-3 border border-amber-500/20 text-xs sm:text-sm"
          >
            <div className="space-y-0.5 min-w-0 flex-1">
              <p className="font-semibold text-foreground text-sm break-words">{item.message}</p>
              {item.detail && (
                <p className="text-xs text-muted-foreground break-words leading-relaxed">{item.detail}</p>
              )}
            </div>
            {item.actionHref ? (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="shrink-0 h-8 rounded-lg text-xs font-semibold gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 self-start sm:self-auto"
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
                className="shrink-0 h-8 rounded-lg text-xs font-semibold gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 self-start sm:self-auto"
              >
                {item.actionLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Export alias for callers
export const WhatsNextSection = AttentionSection;
