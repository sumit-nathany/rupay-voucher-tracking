'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Gift,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  OnboardingWizard,
  isOnboardingDismissed,
  type HolderOption,
  type VariantOption,
} from '@/components/onboarding/onboarding-wizard';
import type { CardTypeOption } from '@/components/cards/card-type-combobox';

export interface WelcomeOnboardingCardProps {
  initialHolders?: HolderOption[];
  types?: CardTypeOption[];
  variants?: VariantOption[];
}

export function WelcomeOnboardingCard({
  initialHolders = [],
  types,
  variants,
}: WelcomeOnboardingCardProps) {
  const searchParams = useSearchParams();
  const [wizardOpen, setWizardOpen] = React.useState(false);

  // Auto-open if onboarding requested via ?onboarding=1 or if first visit (not dismissed)
  React.useEffect(() => {
    const forceOpen = searchParams?.get('onboarding') === '1';
    if (forceOpen || !isOnboardingDismissed()) {
      setWizardOpen(true);
    }
  }, [searchParams]);

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card/90 to-primary/5 p-6 sm:p-8 shadow-xs">
        {/* Subtle decorative glow */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative z-10 flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Welcome to RuPay Voucher Tracker</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                Unlock your card perks in 60 seconds
              </h2>
              <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
                RuPay Select, Platinum, and credit cards come with hundreds of rupees in free quarterly vouchers
                (BookMyShow, Zomato, Spa, Lounge). Add your first card to discover what you are entitled to.
              </p>
            </div>

            {/* Main Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5 sm:self-center shrink-0">
              <Button
                size="lg"
                onClick={() => setWizardOpen(true)}
                className="gap-2 font-semibold shadow-sm text-sm"
              >
                <Sparkles className="h-4 w-4" /> Start Quick Setup
              </Button>
              <Button variant="outline" size="lg" asChild className="text-sm">
                <Link href="/cards">Add Card Manually</Link>
              </Button>
            </div>
          </div>

          {/* 3 Pillars / Feature Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2 border-t border-border/60">
            <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-background/60 p-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Gift className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-foreground">Instant Perk Match</h4>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Automatically populates available dining, movie, and travel vouchers for your exact card type.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-background/60 p-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-foreground">Never Miss a Deadline</h4>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Quarterly vouchers lapse if not claimed in time. We track order deadlines and coupon expiry.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-background/60 p-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Zap className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-foreground">Automation Ready</h4>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Connect your RuPay portal account whenever you want automated 1-click orders and OTP reading.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Onboarding Dialog */}
      <OnboardingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        initialHolders={initialHolders}
        types={types}
        variants={variants}
      />
    </>
  );
}
