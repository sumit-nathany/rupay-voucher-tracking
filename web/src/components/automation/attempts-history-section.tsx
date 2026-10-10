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
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">Recent Automation Activity</h2>
          <p className="text-xs text-muted-foreground">
            Audit history of daily automated benefit attempts and portal booking references.
          </p>
        </div>
      </div>

      {attempts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-8 text-center bg-muted/10">
          <History className="h-8 w-8 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-semibold text-foreground">No Automated Activity Yet</p>
          <p className="text-xs text-muted-foreground max-w-sm mt-1">
            When the scheduled daily worker executes, each attempted order and confirmed booking will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="py-2.5 px-4">Date / Time</th>
                  <th className="py-2.5 px-4">Benefit & Card</th>
                  <th className="py-2.5 px-4">Portal Account</th>
                  <th className="py-2.5 px-4">Outcome</th>
                  <th className="py-2.5 px-4">Booking Reference</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
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
                      <td className="py-3 px-4 font-mono text-muted-foreground">
                        {dateStr}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-foreground">{att.benefitName}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {att.cardName} • {att.holderName}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-medium text-foreground">
                        {att.portalAccountLabel}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-semibold uppercase tracking-wider capitalize ${
                              stateTone[att.state] ?? ''
                            }`}
                          >
                            {att.state.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        {att.failureCode && (
                          <div className="text-[10px] text-destructive mt-0.5 font-medium">
                            {att.failureCode.replace(/_/g, ' ')}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-foreground">
                        {att.bookingReference ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {att.bookingReference}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {att.state === 'uncertain' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setResolvingAttempt(att)}
                            className="h-7 text-xs font-semibold border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
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
