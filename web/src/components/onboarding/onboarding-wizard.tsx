'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Gift,
  Loader2,
  PartyPopper,
  Plus,
  Sparkles,
  User,
} from 'lucide-react';
import { createCard, listBankCardTypes, listCardVariants } from '@/actions/cards';
import { createHolder, listHolders } from '@/actions/holders';
import { loadBenefitsAction } from '@/actions/instance-queries';
import type { InstanceListItem } from '@/domain/instance-queries';
import { defaultView } from '@/components/dashboard/view-params';
import { CardTypeCombobox, type CardTypeOption } from '@/components/cards/card-type-combobox';
import { CurationBadge } from '@/components/cards/curation-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface VariantOption {
  id: string;
  name: string;
}

export interface HolderOption {
  id: string;
  name: string;
}

export interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialHolders?: HolderOption[];
  types?: CardTypeOption[];
  variants?: VariantOption[];
  onComplete?: () => void;
}

import {
  ONBOARDING_DISMISSED_KEY,
  isOnboardingDismissed,
  markOnboardingDismissed,
} from './onboarding-state';

export {
  ONBOARDING_DISMISSED_KEY,
  isOnboardingDismissed,
  markOnboardingDismissed,
};

export function OnboardingWizard({
  open,
  onOpenChange,
  initialHolders = [],
  types: propTypes,
  variants: propVariants,
  onComplete,
}: OnboardingWizardProps) {
  const router = useRouter();

  // Wizard steps: 1 = Holder, 2 = Card, 3 = Reveal
  const [step, setStep] = React.useState<1 | 2 | 3>(1);

  // Loaded catalog options
  const [variants, setVariants] = React.useState<VariantOption[]>(propVariants ?? []);
  const [types, setTypes] = React.useState<CardTypeOption[]>(propTypes ?? []);
  const [holders, setHolders] = React.useState<HolderOption[]>(initialHolders);
  const [loadingData, setLoadingData] = React.useState(false);

  // Step 1: Holder State
  const [holderMode, setHolderMode] = React.useState<'create' | 'existing'>(
    initialHolders.length > 0 ? 'existing' : 'create',
  );
  const [holderName, setHolderName] = React.useState('Self');
  const [holderEmail, setHolderEmail] = React.useState('');
  const [selectedHolderId, setSelectedHolderId] = React.useState(initialHolders[0]?.id ?? '');
  const [selectedHolderName, setSelectedHolderName] = React.useState(initialHolders[0]?.name ?? 'Self');

  // Step 2: Card State
  const [variantId, setVariantId] = React.useState('');
  const [cardType, setCardType] = React.useState<CardTypeOption | null>(null);
  const [lastDigits, setLastDigits] = React.useState('');
  const [cardNickname, setCardNickname] = React.useState('');

  // Step 3: Unlocked Benefits
  const [unlockedCard, setUnlockedCard] = React.useState<{
    id: string;
    displayName: string;
    lastDigits: string;
  } | null>(null);
  const [unlockedBenefits, setUnlockedBenefits] = React.useState<InstanceListItem[]>([]);

  // Action status
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Load types & variants if not provided
  React.useEffect(() => {
    if (!open) return;

    let mounted = true;
    async function loadCatalog() {
      if (types.length > 0 && variants.length > 0 && holders.length > 0) return;
      setLoadingData(true);
      try {
        const [loadedVariants, loadedTypes, loadedHolders] = await Promise.all([
          variants.length === 0 ? listCardVariants() : Promise.resolve(variants),
          types.length === 0 ? listBankCardTypes() : Promise.resolve(types),
          holders.length === 0 ? listHolders() : Promise.resolve(holders),
        ]);
        if (!mounted) return;
        setVariants(loadedVariants);
        setTypes(
          loadedTypes.map((t) => ({
            id: t.id,
            displayName: t.displayName,
            variantId: t.variantId,
            active: t.active !== false,
            curationStatus: t.curationStatus,
          })),
        );
        const mappedHolders = loadedHolders.map((h) => ({ id: h.id, name: h.name }));
        setHolders(mappedHolders);
        if (mappedHolders.length > 0) {
          setSelectedHolderId((prev) => prev || mappedHolders[0].id);
          setSelectedHolderName((prev) => (prev === 'Self' ? mappedHolders[0].name : prev));
        }
      } catch (err) {
        console.error('[OnboardingWizard] Failed to load catalog:', err);
      } finally {
        if (mounted) setLoadingData(false);
      }
    }
    loadCatalog();
    return () => {
      mounted = false;
    };
    // Only check and load when dialog is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default variant selection once variants load
  React.useEffect(() => {
    if (variants.length > 0 && !variantId) {
      // Prefer "Select" variant if exists
      const selectVar = variants.find((v) => v.name.toLowerCase().includes('select')) ?? variants[0];
      setVariantId(selectVar.id);
    }
  }, [variants, variantId]);

  const typesInVariant = React.useMemo(() => {
    return types.filter((t) => t.active && t.variantId === variantId);
  }, [types, variantId]);

  function handleClose(nowOpen: boolean) {
    if (!nowOpen) {
      markOnboardingDismissed();
    }
    onOpenChange(nowOpen);
  }

  // --- Step 1 Submit: Create or select holder ---
  async function handleStep1Submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (holderMode === 'existing') {
      const found = holders.find((h) => h.id === selectedHolderId);
      if (!found) {
        setError('Please select a card holder');
        return;
      }
      setSelectedHolderName(found.name);
      setStep(2);
      return;
    }

    const trimmed = holderName.trim();
    if (!trimmed) {
      setError('Please enter a name for the card holder');
      return;
    }

    setIsPending(true);
    try {
      const created = await createHolder({
        name: trimmed,
        email: holderEmail.trim() || undefined,
      });
      const newHolder: HolderOption = { id: created.id, name: created.name };
      setHolders((prev) => [...prev, newHolder]);
      setSelectedHolderId(created.id);
      setSelectedHolderName(created.name);
      setStep(2);
    } catch (err) {
      console.error('[OnboardingWizard] Failed to create holder:', err);
      setError(err instanceof Error ? err.message : 'Failed to create card holder');
    } finally {
      setIsPending(false);
    }
  }

  // --- Step 2 Submit: Create card & load unlocked perks ---
  async function handleStep2Submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!cardType) {
      setError('Please choose your bank card from the list');
      return;
    }

    const cleanDigits = lastDigits.replace(/\D/g, '');
    if (cleanDigits.length !== 4) {
      setError('Please enter exactly 4 digits for the card (e.g. 6356)');
      return;
    }

    setIsPending(true);
    try {
      const card = await createCard({
        holderId: selectedHolderId,
        bankCardTypeId: cardType.id,
        displayName: cardNickname.trim() || undefined,
        lastDigits: cleanDigits,
      });

      // Query benefits for this newly created card in current period
      const currentView = defaultView();
      const benefitsRes = await loadBenefitsAction({
        view: currentView,
        cardId: card.id,
      });

      setUnlockedCard({
        id: card.id,
        displayName: card.displayName,
        lastDigits: cleanDigits,
      });
      setUnlockedBenefits(benefitsRes);
      setStep(3);
      markOnboardingDismissed();
      if (onComplete) onComplete();
    } catch (err) {
      console.error('[OnboardingWizard] Failed to create card:', err);
      setError(err instanceof Error ? err.message : 'Failed to add card');
    } finally {
      setIsPending(false);
    }
  }

  // Reset to Step 2 to add another card
  function handleAddAnotherCard() {
    setCardType(null);
    setLastDigits('');
    setCardNickname('');
    setError(null);
    setStep(2);
  }

  // Calculate total potential value
  const totalValue = React.useMemo(() => {
    return unlockedBenefits.reduce((sum, item) => sum + (item.value || 0), 0);
  }, [unlockedBenefits]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl p-0 overflow-hidden sm:rounded-2xl border-border/80">
        {/* Progress Header */}
        <div className="bg-gradient-to-r from-primary/10 via-accent/30 to-background border-b border-border/60 p-6 pb-4">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">Quick Setup</span>
                <DialogTitle className="text-lg font-bold leading-tight">Welcome to RuPay Perks</DialogTitle>
              </div>
            </div>
            {/* Step Indicators */}
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                  step === 1
                    ? 'bg-primary text-primary-foreground'
                    : step > 1
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {step > 1 ? <CheckCircle2 className="h-3.5 w-3.5" /> : '1'}
              </span>
              <span className="h-0.5 w-3 bg-border" />
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                  step === 2
                    ? 'bg-primary text-primary-foreground'
                    : step > 2
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {step > 2 ? <CheckCircle2 className="h-3.5 w-3.5" /> : '2'}
              </span>
              <span className="h-0.5 w-3 bg-border" />
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                  step === 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                3
              </span>
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {step === 1 && 'Set up who holds the cards — family, friends, or yourself.'}
            {step === 2 && 'Link your RuPay card to unlock its catalog benefits and vouchers.'}
            {step === 3 && 'Your quarterly vouchers and complimentary benefits are ready!'}
          </DialogDescription>
        </div>

        {/* Modal Body */}
        <div className="p-6 pt-5">
          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive font-medium">
              {error}
            </div>
          )}

          {loadingData ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs font-medium">Preparing catalog...</span>
            </div>
          ) : (
            <>
              {/* ──────────────── STEP 1: HOLDER ──────────────── */}
              {step === 1 && (
                <form onSubmit={handleStep1Submit} className="space-y-4">
                  {holders.length > 0 && (
                    <div className="flex rounded-lg bg-muted/40 p-1 border border-border/60">
                      <button
                        type="button"
                        onClick={() => setHolderMode('existing')}
                        className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
                          holderMode === 'existing'
                            ? 'bg-background shadow-xs text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Choose Existing Holder
                      </button>
                      <button
                        type="button"
                        onClick={() => setHolderMode('create')}
                        className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
                          holderMode === 'create'
                            ? 'bg-background shadow-xs text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        + Add New Holder
                      </button>
                    </div>
                  )}

                  {holderMode === 'existing' && holders.length > 0 ? (
                    <div className="space-y-2">
                      <Label htmlFor="existing-holder" className="text-xs font-semibold">
                        Select Card Holder
                      </Label>
                      {/* Styled native select avoiding nested Radix portal issues */}
                      <select
                        id="existing-holder"
                        value={selectedHolderId}
                        onChange={(e) => setSelectedHolderId(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        {holders.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="holder-name" className="text-xs font-semibold">
                          Holder Name <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="holder-name"
                            value={holderName}
                            onChange={(e) => setHolderName(e.target.value)}
                            placeholder="e.g. Self, Sumit, Mom"
                            className="pl-9 text-sm"
                            required
                            autoFocus
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Holders help you organize perks across different family members.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="holder-email" className="text-xs font-semibold">
                          Email Address <span className="text-muted-foreground font-normal">(optional)</span>
                        </Label>
                        <Input
                          id="holder-email"
                          type="email"
                          value={holderEmail}
                          onChange={(e) => setHolderEmail(e.target.value)}
                          placeholder="e.g. holder@example.com"
                          className="text-sm"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-border/50">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleClose(false)}
                      className="text-xs text-muted-foreground"
                    >
                      Skip for now
                    </Button>
                    <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
                      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Next: Add Card <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </form>
              )}

              {/* ──────────────── STEP 2: CARD ──────────────── */}
              {step === 2 && (
                <form onSubmit={handleStep2Submit} className="space-y-4">
                  {/* Selected Holder Pill */}
                  <div className="flex items-center justify-between rounded-lg bg-muted/30 border border-border/60 px-3 py-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Holder:</span>
                      <span className="font-semibold text-foreground">{selectedHolderName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Change
                    </button>
                  </div>

                  {/* Card Variant (RuPay Select / Platinum / etc.) */}
                  <div className="space-y-1.5">
                    <Label htmlFor="wizard-variant" className="text-xs font-semibold">
                      Card Variant
                    </Label>
                    <select
                      id="wizard-variant"
                      value={variantId}
                      onChange={(e) => {
                        setVariantId(e.target.value);
                        setCardType(null);
                      }}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Searchable Bank Card Type Combobox */}
                  <div className="space-y-1.5">
                    <Label htmlFor="wizard-card-type" className="text-xs font-semibold">
                      Bank & Card Name <span className="text-destructive">*</span>
                    </Label>
                    <CardTypeCombobox
                      id="wizard-card-type"
                      options={typesInVariant}
                      value={cardType}
                      onChange={(t) => setCardType(t)}
                    />
                    {cardType && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                        Selected: <span className="font-medium text-foreground">{cardType.displayName}</span>
                        <CurationBadge status={cardType.curationStatus} />
                      </p>
                    )}
                  </div>

                  {/* Last 4 Digits & Nickname Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="wizard-last-digits" className="text-xs font-semibold">
                        Last 4 Digits <span className="text-destructive">*</span>
                      </Label>
                      <div className="relative">
                        <CreditCard className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="wizard-last-digits"
                          maxLength={4}
                          value={lastDigits}
                          onChange={(e) => setLastDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          placeholder="e.g. 6356"
                          className="pl-9 font-mono text-sm tracking-wider"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="wizard-nickname" className="text-xs font-semibold">
                        Nickname <span className="text-muted-foreground font-normal">(optional)</span>
                      </Label>
                      <Input
                        id="wizard-nickname"
                        value={cardNickname}
                        onChange={(e) => setCardNickname(e.target.value)}
                        placeholder={cardType?.displayName ?? 'My RuPay Card'}
                        className="text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border/50">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setStep(1)}
                      className="text-xs gap-1"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Back
                    </Button>
                    <Button type="submit" size="sm" disabled={isPending || !cardType} className="gap-1.5 shadow-sm">
                      {isPending ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Unlocking Perks...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" /> Unlock Perks & Benefits
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              )}

              {/* ──────────────── STEP 3: REVEAL ("AHA!" MOMENT) ──────────────── */}
              {step === 3 && (
                <div className="space-y-4 text-center sm:text-left">
                  {/* Celebration Banner */}
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <PartyPopper className="h-6 w-6" />
                      </div>
                      <div>
                        <h4 className="font-bold text-foreground text-sm sm:text-base">
                          {unlockedCard?.displayName}
                        </h4>
                        <p className="text-xs text-muted-foreground font-mono">
                          •••• {unlockedCard?.lastDigits} &middot; Holder: {selectedHolderName}
                        </p>
                      </div>
                    </div>
                    {/* Value Pill */}
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-bold px-2.5 py-1 bg-background text-primary border-primary/30">
                        {unlockedBenefits.length} Benefits
                      </Badge>
                      {totalValue > 0 && (
                        <Badge className="text-xs font-bold px-2.5 py-1 bg-emerald-600 text-white">
                          ₹{totalValue.toLocaleString('en-IN')} Value
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* List of Unlocked Perks */}
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Active Benefits for this Period
                    </span>
                    {unlockedBenefits.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border/80 p-4 text-center text-xs text-muted-foreground">
                        Card added successfully! No specific catalog perks found for this variant in the current quarter, but all card benefits will track automatically.
                      </div>
                    ) : (
                      <div className="max-h-56 overflow-y-auto space-y-2 pr-1 rounded-lg border border-border/50 bg-muted/10 p-2">
                        {unlockedBenefits.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background p-2.5 shadow-2xs hover:border-border transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                <Gift className="h-3.5 w-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-foreground truncate">
                                  {item.benefitName}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                  {item.benefitType} &middot; {item.periodLabel}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Badge variant="outline" className="text-[10px] font-medium">
                                {item.frequency}
                              </Badge>
                              {item.value > 0 ? (
                                <span className="text-xs font-bold text-foreground">
                                  ₹{item.value}
                                </span>
                              ) : (
                                <span className="text-xs font-semibold text-emerald-600">
                                  Free
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Next Step Actions */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-border/50">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddAnotherCard}
                      className="w-full sm:w-auto text-xs gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Another Card
                    </Button>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          handleClose(false);
                          router.push('/');
                          router.refresh();
                        }}
                        className="flex-1 sm:flex-initial text-xs"
                      >
                        Go to Dashboard
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          handleClose(false);
                          router.push(unlockedCard ? `/benefits?card=${unlockedCard.id}` : '/benefits');
                          router.refresh();
                        }}
                        className="flex-1 sm:flex-initial text-xs gap-1 font-semibold shadow-xs"
                      >
                        View Benefits <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
