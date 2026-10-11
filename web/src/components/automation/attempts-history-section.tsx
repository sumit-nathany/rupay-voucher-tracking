'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AttemptView } from '@/domain/automation';
import { ResolveUncertainDialog } from './resolve-uncertain-dialog';

export function AttemptsHistorySection({ attempts }: { attempts: AttemptView[] }) {
  const [resolvingAttempt, setResolvingAttempt] = useState<AttemptView | null>(null);

  const stateTone = {
    confirmed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    submitting: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    uncertain: 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold',
    failed_pre_submit: 'border-destructive/30 bg-destructive/10 text-destructive',
    resolved_no_order: 'border-muted-foreground/30 bg-muted/40 text-muted-foreground',
    cancelled: 'border-muted-foreground/30 bg-muted/40 text-muted-foreground',
    reserved: 'border-muted-foreground/30 bg-muted/40 text-muted-foreground',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">Recent Automation Activity</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Audit history of daily automated benefit attempts and portal booking references.
          </p>
        </div>
      </div>

      {attempts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-12 text-center bg-muted/10">
          <History className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-base font-semibold text-foreground">No Automated Activity Yet</p>
          <p className="text-sm text-muted-foreground max-w-sm mt-1.5">
            When the scheduled daily worker executes, each attempted order and confirmed booking will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs mt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Date / Time</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Benefit & Card</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Portal Account</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Outcome</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6">Booking Reference</th>
                  <th className="py-3.5 sm:py-4 px-5 sm:px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {attempts.map((att) => {
                  const dateStr = new Date(att.reservedAt).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <tr key={att.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-4 sm:py-5 px-5 sm:px-6 text-xs sm:text-sm text-muted-foreground">
                        {dateStr}
                      </td>
                      <td className="py-4 sm:py-5 px-5 sm:px-6">
                        <div className="font-semibold text-sm sm:text-base text-foreground">{att.benefitName}</div>
                        <div className="text-xs sm:text-sm text-muted-foreground mt-1">
                          {att.cardName} • {att.holderName}
                        </div>
                      </td>
                      <td className="py-4 sm:py-5 px-5 sm:px-6 font-medium text-sm sm:text-base text-foreground">
                        {att.portalAccountLabel}
                      </td>
                      <td className="py-4 sm:py-5 px-5 sm:px-6">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={`text-xs px-2.5 py-0.5 font-medium rounded-lg capitalize ${
                              stateTone[att.state] ?? ''
                            }`}
                          >
                            {att.state.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        {att.failureCode && (
                          <div className="text-xs text-destructive mt-1 font-medium">
                            {att.failureCode.replace(/_/g, ' ')}
                          </div>
                        )}
                      </td>
                      <td className="py-4 sm:py-5 px-5 sm:px-6 font-mono text-xs sm:text-sm font-medium text-foreground">
                        {att.bookingReference ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                            {att.bookingReference}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="py-4 sm:py-5 px-5 sm:px-6 text-right">
                        {att.state === 'uncertain' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setResolvingAttempt(att)}
                            className="h-9 px-3.5 rounded-xl text-xs sm:text-sm font-semibold border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                          >
                            Resolve Order
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Resolution Dialog */}
      <ResolveUncertainDialog
        attempt={resolvingAttempt}
        open={Boolean(resolvingAttempt)}
        onOpenChange={(open) => {
          if (!open) setResolvingAttempt(null);
        }}
      />
    </div>
  );
}
