'use client';

import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, ArrowRight, Plus, Pause, Play, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pausePortalAccountAction, resumePortalAccountAction } from '@/actions/automation';
import type { PortalAccountView, PortalCardMappingView } from '@/domain/automation';
import type { CardOption } from './mapping-dialogs';

export function PortalAccountsSection({
  accounts,
}: {
  accounts: PortalAccountView[];
  mappings?: PortalCardMappingView[];
  availableCards?: CardOption[];
}) {
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleToggleAccountPause(id: string, currentlyPaused: boolean) {
    setTogglingId(id);
    try {
      if (currentlyPaused) {
        await resumePortalAccountAction({ id });
      } else {
        await pausePortalAccountAction({ id });
      }
    } catch (err) {
      console.error('Failed to toggle account pause state:', err);
    } finally {
      setTogglingId(null);
    }
  }

  const activeEcosystemAccounts = accounts.filter((a) => a.active);
  const inactiveCount = accounts.filter((a) => !a.active).length;
  const activeCount = activeEcosystemAccounts.filter((a) => a.automationEnabled && a.status === 'connected').length;
  const pausedCount = activeEcosystemAccounts.filter((a) => !a.automationEnabled).length;
  const cooldownCount = activeEcosystemAccounts.filter(
    (a) => a.status === 'connected' && Boolean(a.cooldownUntil && new Date(a.cooldownUntil) > new Date()),
  ).length;

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs flex flex-col justify-between h-full space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-foreground leading-tight">
                RuPay Accounts
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sign-in & card mappings
              </p>
            </div>
          </div>
          {activeEcosystemAccounts.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-xs font-medium">
                {activeCount} active
              </Badge>
              {pausedCount > 0 && (
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium">
                  {pausedCount} paused
                </Badge>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          {activeEcosystemAccounts.length > 0
            ? `${activeEcosystemAccounts.length} active ${activeEcosystemAccounts.length === 1 ? 'account' : 'accounts'} in workspace. Pause or resume individual accounts for automated sweeps below:`
            : 'Connect your RuPay portal logins to enable automated voucher ordering for your cards.'}
        </p>

        {cooldownCount > 0 && (
          <div className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px] py-0 px-1.5 font-medium">
              {cooldownCount} in cooldown
            </Badge>
          </div>
        )}

        {/* Accounts List with Quick Pause/Resume Toggle */}
        {activeEcosystemAccounts.length > 0 && (
          <div className="space-y-2 pt-1 max-h-60 overflow-y-auto pr-1">
            {activeEcosystemAccounts.map((acc) => {
              const isPaused = !acc.automationEnabled;
              const isNeedsAttention = acc.status === 'needs_attention';
              return (
                <div
                  key={acc.id}
                  className="flex items-center justify-between gap-2.5 p-2.5 rounded-xl border border-border/60 bg-muted/20 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium text-foreground truncate" title={acc.label}>
                      {acc.label}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                      {isPaused ? (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                          Paused from Automation
                        </Badge>
                      ) : isNeedsAttention ? (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-destructive/40 bg-destructive/10 text-destructive font-medium">
                          Needs Attention
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
                          Active
                        </Badge>
                      )}
                      <span className="text-muted-foreground">• {acc.mappingsCount} cards</span>
                    </div>
                  </div>

                  {!isNeedsAttention && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={togglingId === acc.id}
                      onClick={() => handleToggleAccountPause(acc.id, isPaused)}
                      className="h-7 px-2 text-[11px] font-medium shrink-0 rounded-lg hover:bg-accent cursor-pointer"
                      title={isPaused ? "Resume automated ordering for this account" : "Pause automated ordering for this account"}
                    >
                      {togglingId === acc.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isPaused ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                          <Play className="h-3 w-3 fill-current" /> Resume
                        </span>
                      ) : (
                        <span className="text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 flex items-center gap-1">
                          <Pause className="h-3 w-3" /> Pause
                        </span>
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {inactiveCount > 0 && (
          <p className="text-[11px] text-muted-foreground pt-1">
            {inactiveCount} account{inactiveCount === 1 ? ' is' : 's are'} marked{' '}
            <span className="font-semibold text-foreground">Inactive</span> across the workspace and excluded from automation entirely.{' '}
            <Link href="/accounts" className="text-primary hover:underline font-medium">
              Manage on Accounts
            </Link>
          </p>
        )}
      </div>

      <div className="pt-2 border-t border-border/40">
        <Button asChild size="sm" variant="outline" className="w-full h-9 rounded-xl gap-2 text-xs font-semibold cursor-pointer border-border/80 hover:bg-accent">
          <Link href="/accounts">
            {accounts.length > 0 ? (
              <>
                Manage Credentials & Mappings
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Add RuPay Account
              </>
            )}
          </Link>
        </Button>
      </div>
    </div>
  );
}
