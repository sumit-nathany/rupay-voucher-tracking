'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Globe, IndianRupee, Pencil, Plus } from 'lucide-react';
import { changeBenefitValueAction } from '@/actions/benefit-values';
import type { BenefitValueOverrideView, WorkspaceDistinctBenefit } from '@/domain/benefit-values';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SheetFooter } from '@/components/ui/sheet';
import { ErrorText, Field, FormSheet, SubmitButton } from '@/components/holders/form-kit';
import { cn } from '@/lib/utils';

function BenefitValueFormBody({
  override,
  distinctBenefits,
  isSystemAdmin = false,
  close,
}: {
  override?: BenefitValueOverrideView;
  distinctBenefits: WorkspaceDistinctBenefit[];
  isSystemAdmin?: boolean;
  close: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const editing = Boolean(override);

  const uid = React.useId();
  const [selectedName, setSelectedName] = React.useState(override?.benefitName ?? '');
  const [customInputName, setCustomInputName] = React.useState('');
  const [isManualInput, setIsManualInput] = React.useState(false);
  const [customValue, setCustomValue] = React.useState(override ? String(override.customValue) : '');
  const [scope, setScope] = React.useState<'workspace' | 'all_workspaces'>('workspace');

  // Find info about selected benefit
  const selectedInfo = React.useMemo(() => {
    const matchName = isManualInput ? customInputName : selectedName;
    return distinctBenefits.find(
      (b) => b.benefitName.toLowerCase().trim() === matchName.toLowerCase().trim(),
    );
  }, [distinctBenefits, selectedName, customInputName, isManualInput]);

  // Available options for selection (if adding new, highlight those not already customized)
  const availableChoices = React.useMemo(() => {
    return distinctBenefits.filter((b) => !b.overrideId || b.benefitName === override?.benefitName);
  }, [distinctBenefits, override]);

  // Unique categories derived from available benefits
  const categories = React.useMemo(() => {
    const set = new Set<string>();
    for (const b of availableChoices) {
      set.add(b.benefitType?.trim() || 'Other');
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [availableChoices]);

  const initialCategory = React.useMemo(() => {
    if (override?.benefitType) return override.benefitType;
    if (override?.benefitName) {
      const match = distinctBenefits.find(
        (b) => b.benefitName.toLowerCase().trim() === override.benefitName.toLowerCase().trim(),
      );
      if (match?.benefitType) return match.benefitType;
    }
    return '';
  }, [override, distinctBenefits]);

  const [selectedCategory, setSelectedCategory] = React.useState<string>(initialCategory);

  // Filtered benefits based on selected category
  const filteredChoices = React.useMemo(() => {
    if (!selectedCategory) return [];
    if (selectedCategory === '__all__') return availableChoices;
    return availableChoices.filter(
      (b) => (b.benefitType?.trim() || 'Other') === selectedCategory,
    );
  }, [availableChoices, selectedCategory]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalName = (editing ? override!.benefitName : isManualInput ? customInputName : selectedName).trim();
    if (!finalName) {
      setError('Please select or specify a benefit name.');
      return;
    }

    const val = Number(customValue.trim());
    if (isNaN(val) || val < 0) {
      setError('Please enter a valid valuation amount (₹0 or greater).');
      return;
    }

    setPending(true);
    setError(null);

    try {
      const res = await changeBenefitValueAction({
        benefitName: finalName,
        value: Math.round(val * 100) / 100,
        scope,
        benefitType:
          selectedInfo?.benefitType ??
          (selectedCategory && selectedCategory !== '__all__' && selectedCategory !== 'Other'
            ? selectedCategory
            : null) ??
          override?.benefitType ??
          null,
        benefitProvider: selectedInfo?.benefitProvider ?? override?.benefitProvider ?? null,
        benefitId: override?.benefitId ?? null,
      });

      if (!res.success) {
        setError(res.error || 'Could not save custom valuation.');
        return;
      }

      router.refresh();
      close();
    } catch (err: unknown) {
      console.error('[BenefitValueFormBody]', err);
      setError(err instanceof Error ? err.message : 'Could not save custom valuation.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4">
      {editing ? (
        <div className="space-y-1 rounded-lg bg-muted/50 p-3 border border-border/50 text-xs">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Benefit</span>
          <p className="font-semibold text-foreground text-sm">{override!.benefitName}</p>
          {(override?.benefitType || override?.benefitProvider) && (
            <p className="text-muted-foreground text-xs">
              {[override?.benefitType, override?.benefitProvider].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {!isManualInput && availableChoices.length > 0 ? (
            <>
              <Field id={`${uid}-category`} label="Category" hint="Choose category first">
                <Select
                  value={selectedCategory}
                  onValueChange={(cat) => {
                    setSelectedCategory(cat);
                    const stillValid = availableChoices.some(
                      (b) =>
                        b.benefitName === selectedName &&
                        (cat === '__all__' || (b.benefitType?.trim() || 'Other') === cat),
                    );
                    if (!stillValid) {
                      setSelectedName('');
                    }
                  }}
                >
                  <SelectTrigger id={`${uid}-category`} className="w-full">
                    <SelectValue placeholder="Choose a category…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Categories ({availableChoices.length})</SelectItem>
                    {categories.map((cat) => {
                      const count = availableChoices.filter(
                        (b) => (b.benefitType?.trim() || 'Other') === cat,
                      ).length;
                      return (
                        <SelectItem key={cat} value={cat}>
                          {cat} ({count})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                id={`${uid}-select`}
                label="Benefit"
                hint={
                  selectedCategory
                    ? `Showing benefits in ${selectedCategory === '__all__' ? 'all categories' : selectedCategory}`
                    : 'Select a category above to view benefits'
                }
              >
                <Select
                  value={selectedName}
                  disabled={!selectedCategory}
                  onValueChange={(v) => {
                    if (v === '__manual__') {
                      setIsManualInput(true);
                      setSelectedName('');
                    } else {
                      setSelectedName(v);
                    }
                  }}
                >
                  <SelectTrigger id={`${uid}-select`} className="w-full">
                    <SelectValue
                      placeholder={
                        selectedCategory ? 'Choose a benefit…' : 'Select a category first…'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredChoices.map((b) => (
                      <SelectItem key={b.benefitName} value={b.benefitName}>
                        {b.benefitName} {b.catalogValue != null ? `(Catalog: ₹${b.catalogValue})` : ''}
                      </SelectItem>
                    ))}
                    <SelectItem value="__manual__">Type custom benefit name…</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : (
            <div className="space-y-2">
              <Field id={`${uid}-name`} label="Benefit Name" hint="Exact name of the voucher or benefit">
                <Input
                  id={`${uid}-name`}
                  value={customInputName}
                  onChange={(e) => setCustomInputName(e.target.value)}
                  placeholder="e.g. BookMyShow ₹250 Voucher"
                  required
                />
              </Field>
              {availableChoices.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  onClick={() => {
                    setIsManualInput(false);
                    setCustomInputName('');
                  }}
                >
                  ← Select from existing categories & benefits
                </button>
              )}
            </div>
          )}

          {selectedInfo && selectedInfo.catalogValue != null && (
            <div className="rounded-lg bg-muted/40 p-2.5 border border-border/40 text-xs flex justify-between items-center">
              <span className="text-muted-foreground">RuPay Catalog Nominal Value:</span>
              <span className="font-semibold text-foreground">₹{selectedInfo.catalogValue}</span>
            </div>
          )}
        </div>
      )}

      <Field
        id={`${uid}-val`}
        label="My Valuation (₹)"
        hint="The value you place on this benefit. Will be reflected in dashboard totals and benefit lists."
      >
        <div className="relative">
          <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id={`${uid}-val`}
            type="number"
            step="0.01"
            min="0"
            className="pl-9"
            placeholder={selectedInfo?.catalogValue != null ? String(selectedInfo.catalogValue) : 'e.g. 200'}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            required
            autoFocus={editing}
          />
        </div>
      </Field>

      {isSystemAdmin && (
        <Field id={`${uid}-scope`} label="Application Scope" hint="Super admin capability">
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label
              className={cn(
                'flex flex-col p-2.5 rounded-lg border text-left cursor-pointer transition-colors select-none text-xs',
                scope === 'workspace'
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border/60 hover:bg-muted/40 text-muted-foreground',
              )}
            >
              <input
                type="radio"
                name={`${uid}-val-scope`}
                value="workspace"
                checked={scope === 'workspace'}
                onChange={() => setScope('workspace')}
                className="sr-only"
              />
              <span className="font-semibold">This Workspace</span>
              <span className="text-[10px] mt-0.5 leading-tight opacity-80">
                Cards in this workspace only
              </span>
            </label>

            <label
              className={cn(
                'flex flex-col p-2.5 rounded-lg border text-left cursor-pointer transition-colors select-none text-xs',
                scope === 'all_workspaces'
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border/60 hover:bg-muted/40 text-muted-foreground',
              )}
            >
              <input
                type="radio"
                name={`${uid}-val-scope`}
                value="all_workspaces"
                checked={scope === 'all_workspaces'}
                onChange={() => setScope('all_workspaces')}
                className="sr-only"
              />
              <div className="flex items-center gap-1">
                <Globe className="h-3 w-3 text-amber-500" />
                <span className="font-semibold">All Workspaces</span>
              </div>
              <span className="text-[10px] mt-0.5 leading-tight opacity-80">
                Catalog default for everyone
              </span>
            </label>
          </div>
        </Field>
      )}

      <ErrorText>{error}</ErrorText>

      <SheetFooter className="mt-auto">
        <SubmitButton pending={pending}>
          {editing ? 'Update Valuation' : 'Save Valuation'}
        </SubmitButton>
      </SheetFooter>
    </form>
  );
}

export function BenefitValueFormSheet({
  override,
  distinctBenefits = [],
  isSystemAdmin = false,
}: {
  override?: BenefitValueOverrideView;
  distinctBenefits?: WorkspaceDistinctBenefit[];
  isSystemAdmin?: boolean;
}) {
  if (override) {
    return (
      <FormSheet
        trigger={<><Pencil className="h-3.5 w-3.5 mr-1" aria-hidden />Edit</>}
        triggerProps={{ variant: 'outline', size: 'sm', 'aria-label': `Edit valuation for ${override.benefitName}` }}
        title="Edit Benefit Valuation"
        description="Update your personal valuation for this benefit across all cards."
      >
        {(close) => (
          <BenefitValueFormBody
            override={override}
            distinctBenefits={distinctBenefits}
            isSystemAdmin={isSystemAdmin}
            close={close}
          />
        )}
      </FormSheet>
    );
  }

  return (
    <FormSheet
      trigger={<><Plus className="h-4 w-4 mr-1.5" aria-hidden />Set Custom Value</>}
      triggerProps={{ size: 'sm' }}
      title="Set Custom Benefit Valuation"
      description="Define your own valuation for a benefit. This value will replace RuPay’s catalog nominal value across all cards."
    >
      {(close) => (
        <BenefitValueFormBody
          distinctBenefits={distinctBenefits}
          isSystemAdmin={isSystemAdmin}
          close={close}
        />
      )}
    </FormSheet>
  );
}
