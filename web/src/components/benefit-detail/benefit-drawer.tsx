'use client';

import * as React from 'react';
import {
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Gift,
  IndianRupee,
  Layers,
  Loader2,
  Pencil,
  Tag,
} from 'lucide-react';
import {
  chooseOptionAction,
  getInstanceAction,
  getInstanceOptionsAction,
  recordSaleAction,
  revealCodeAction,
  setCodeAction,
  setStatusAction,
  unskipInstanceAction,
  updateDetailsAction,
} from '@/actions/instances';
import type { BenefitOptionView, InstanceView, OrderStatus, RevealedCode } from '@/domain/instances';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  AUTO_HIDE_MS,
  CODE_MASK,
  COPIED_MS,
  WORKFLOW_STATUSES,
  canEdit,
  canRecordSale,
  errorMessage,
  formatDate,
  formatMoney,
  parseMoney,
  statusKind,
  validateCode,
  validateDetails,
  type DetailsErrors,
  type DetailsForm,
} from './helpers';

// Props contract is relied on by the Benefits page. Do not change.
export interface BenefitDrawerProps {
  instanceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any successful change so the parent list can refresh. */
  onChanged: () => void;
  /** Optional names from the list row; the instance row itself only carries ids. */
  title?: string;
  subtitle?: string;
}

export function BenefitDrawer({ instanceId, open, onOpenChange, onChanged, title, subtitle }: BenefitDrawerProps) {
  const [inst, setInst] = React.useState<InstanceView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async (id: string, isCurrent: () => boolean) => {
    setLoadError(null);
    try {
      const v = await getInstanceAction(id);
      if (isCurrent()) setInst(v);
    } catch (e) {
      if (isCurrent()) setLoadError(errorMessage(e, 'Could not load this benefit.'));
    }
  }, []);

  React.useEffect(() => {
    if (!open || !instanceId) return;
    let current = true;
    setInst(null);
    void load(instanceId, () => current);
    return () => {
      current = false;
    };
  }, [open, instanceId, load]);

  /** After a successful mutation: adopt the returned row and tell the parent. */
  const applied = React.useCallback(
    (v: InstanceView) => {
      setInst(v);
      onChanged();
    },
    [onChanged],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="benefit-drawer-desc" className="gap-5 sm:max-w-md">
        <SheetHeader className="pb-1 border-b border-border/50">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20"
            >
              <Gift className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 pr-6">
              <SheetTitle className="text-base font-bold leading-snug truncate">
                {title ?? 'Benefit details'}
              </SheetTitle>
              <SheetDescription id="benefit-drawer-desc" className="text-xs truncate text-muted-foreground mt-0.5">
                {inst
                  ? `${subtitle ? `${subtitle} · ` : ''}${inst.periodLabel}${
                      inst.instanceNumber > 1 ? ` · #${inst.instanceNumber}` : ''
                    }`
                  : 'Loading…'}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {loadError ? (
          <div role="alert" className="space-y-3 py-6 text-center">
            <p className="text-sm text-destructive">{loadError}</p>
            {instanceId && (
              <Button variant="outline" size="sm" onClick={() => void load(instanceId, () => true)}>
                Retry
              </Button>
            )}
          </div>
        ) : !inst ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
            <p className="text-xs">Loading benefit details…</p>
          </div>
        ) : (
          <DrawerBody
            key={inst.id}
            inst={inst}
            open={open}
            applied={applied}
            reload={() => load(inst.id, () => true)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── body ────────────────────────────────────────────────────────────────────

function DrawerBody({
  inst,
  open,
  applied,
  reload,
}: {
  inst: InstanceView;
  open: boolean;
  applied: (v: InstanceView) => void;
  reload: () => Promise<void>;
}) {
  const kind = statusKind(inst.orderStatus);
  const editable = canEdit(inst.orderStatus);

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* 1. Hero Card: Key numbers & Status */}
      <HeroCard inst={inst} applied={applied} reload={reload} />

      {/* 2. Choose One Option (if applicable) */}
      <OptionSection inst={inst} editable={editable} applied={applied} />

      {/* 3. Withdrawn notice (if withdrawn) */}
      {kind === 'withdrawn' && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-xs" role="note">
          <p className="font-semibold text-destructive">Withdrawn Benefit</p>
          <p className="mt-1 text-muted-foreground leading-relaxed">
            This benefit is no longer active for this card: the bank dropped it, or it was suppressed in catalog
            overrides. It cannot be edited.
          </p>
        </div>
      )}

      {/* 4. Voucher Code Vault */}
      <CodeSection inst={inst} open={open} editable={editable} applied={applied} />

      {/* 5. Booking & Order Details (Clean read-only by default, editable on demand) */}
      <DetailsSection
        key={`d-${String(inst.updatedAt)}`}
        inst={inst}
        editable={editable}
        applied={applied}
        reload={reload}
      />

      {/* 6. Sale Tracking (Collapsible) */}
      {kind === 'workflow' && (
        <SaleSection
          key={`s-${String(inst.updatedAt)}`}
          inst={inst}
          applied={applied}
          reload={reload}
        />
      )}
    </div>
  );
}

// ── Hero Card ───────────────────────────────────────────────────────────────

function HeroCard({
  inst,
  applied,
  reload,
}: {
  inst: InstanceView;
  applied: (v: InstanceView) => void;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const kind = statusKind(inst.orderStatus);
  const selectId = React.useId();

  async function run(fn: () => Promise<InstanceView>) {
    setBusy(true);
    setError(null);
    try {
      applied(await fn());
    } catch (e) {
      setError(errorMessage(e));
      void reload();
    } finally {
      setBusy(false);
    }
  }

  async function onStatusChange(next: string) {
    if (next === inst.orderStatus) return;
    if (kind === 'skipped' && next === 'Not Ordered') {
      await run(() => unskipInstanceAction(inst.id));
      return;
    }
    await run(() => setStatusAction({ instanceId: inst.id, status: next as OrderStatus }));
  }

  const options = kind === 'skipped' ? (['Skipped', 'Not Ordered'] as const) : WORKFLOW_STATUSES;

  return (
    <div className="rounded-2xl border border-border/70 bg-gradient-to-b from-muted/50 to-muted/20 p-4 space-y-3.5 shadow-xs">
      {/* Top Metrics Row */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">Value</span>
          <p className="text-2xl font-bold tracking-tight text-foreground">{formatMoney(inst.cashValue)}</p>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            Order Deadline
          </span>
          <p className="text-xs font-semibold text-foreground flex items-center justify-end gap-1.5 mt-0.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDate(inst.orderDeadline)}
          </p>
        </div>
      </div>

      <div className="h-px bg-border/60" />

      {/* Status Row */}
      <div className="space-y-1.5">
        <Label htmlFor={selectId} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Status
        </Label>

        <Select value={inst.orderStatus} onValueChange={(v) => void onStatusChange(v)} disabled={busy}>
          <SelectTrigger id={selectId} aria-label="Order status" className="h-9 w-full bg-background font-medium text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ── "redeem any one" choice ─────────────────────────────────────────────────

function OptionSection({
  inst,
  editable,
  applied,
}: {
  inst: InstanceView;
  editable: boolean;
  applied: (v: InstanceView) => void;
}) {
  const [options, setOptions] = React.useState<BenefitOptionView[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();

  React.useEffect(() => {
    let current = true;
    getInstanceOptionsAction(inst.id)
      .then((o) => current && setOptions(o))
      .catch(() => current && setOptions([]));
    return () => {
      current = false;
    };
  }, [inst.id]);

  if (!options || options.length === 0) return null;

  async function choose(optionId: string) {
    setBusy(true);
    setError(null);
    try {
      applied(await chooseOptionAction({ instanceId: inst.id, optionId: optionId || null }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 space-y-2">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h4 className="text-xs font-semibold text-foreground">Choose one of {options.length} offers</h4>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        This benefit allows one redemption this period. Pick the offer you redeemed.
      </p>

      <Select
        value={inst.chosenOptionId ?? '__none__'}
        disabled={busy || !editable}
        onValueChange={(v) => void choose(v === '__none__' ? '' : v)}
      >
        <SelectTrigger id={id} className="h-9 w-full bg-background text-xs font-medium">
          <SelectValue placeholder="Not chosen yet" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Not chosen yet</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.provider}: {o.offerName}
              {o.cashValue != null ? ` (${formatMoney(o.cashValue)})` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ── voucher code ────────────────────────────────────────────────────────────

type CopyKey = 'code' | 'number' | 'pin';

function CodeSection({
  inst,
  open,
  editable,
  applied,
}: {
  inst: InstanceView;
  open: boolean;
  editable: boolean;
  applied: (v: InstanceView) => void;
}) {
  const [revealed, setRevealed] = React.useState<RevealedCode | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<CopyKey | null>(null);
  const [copyError, setCopyError] = React.useState(false);
  const [editingCode, setEditingCode] = React.useState(false);
  const generation = React.useRef(0);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = React.useCallback(() => {
    generation.current += 1;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setRevealed(null);
    setRevealing(false);
  }, []);

  React.useEffect(() => {
    if (!open) hide();
  }, [open, hide]);

  React.useEffect(
    () => () => {
      generation.current += 1;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  async function reveal() {
    const gen = ++generation.current;
    setRevealing(true);
    setError(null);
    try {
      const r = await revealCodeAction(inst.id);
      if (gen !== generation.current) return;
      if (!r) {
        setError('No code is stored for this benefit.');
        return;
      }
      setRevealed(r);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(hide, AUTO_HIDE_MS);
    } catch {
      if (gen === generation.current) setError('Could not reveal the code. Please try again.');
    } finally {
      if (gen === generation.current) setRevealing(false);
    }
  }

  async function copy(text: string, key: CopyKey) {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
    } catch {
      setCopied(null);
      setCopyError(true);
    }
  }

  const CopyBtn = ({ text, k, label }: { text: string; k: CopyKey; label: string }) => (
    <Button
      variant="outline"
      size="sm"
      className="h-8 shrink-0 gap-1.5 px-2.5 text-xs font-medium"
      onClick={() => void copy(text, k)}
      aria-label={`Copy ${label}`}
    >
      {copied === k ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === k ? 'Copied' : 'Copy'}
    </Button>
  );

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <Tag className="h-3.5 w-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">Voucher Code</h4>
          </div>
        </div>
        {inst.hasCode && editable && !editingCode && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setEditingCode(true)}
          >
            <Pencil className="h-3 w-3" /> Replace
          </Button>
        )}
      </div>

      {inst.hasCode ? (
        revealed ? (
          <div className="space-y-2">
            {revealed.number != null && revealed.pin != null ? (
              <div className="grid gap-2">
                <CodeRow
                  label="Card Number"
                  value={revealed.number}
                  action={<CopyBtn text={revealed.number} k="number" label="number" />}
                />
                <CodeRow
                  label="PIN"
                  value={revealed.pin}
                  action={<CopyBtn text={revealed.pin} k="pin" label="PIN" />}
                />
              </div>
            ) : (
              <CodeRow
                label="Code"
                value={revealed.code}
                action={<CopyBtn text={revealed.code} k="code" label="code" />}
              />
            )}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground">Auto-hides in 30 seconds</span>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={hide}>
                <EyeOff className="h-3 w-3" /> Hide
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/25 px-3.5 py-2.5">
            <span className="font-mono text-base tracking-widest text-muted-foreground/80">
              {CODE_MASK}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs font-medium"
              disabled={revealing}
              onClick={() => void reveal()}
            >
              {revealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Reveal
            </Button>
          </div>
        )
      ) : (
        !editingCode && (
          <div className="flex items-center justify-between rounded-xl border border-dashed border-border/80 bg-muted/20 px-3.5 py-3">
            <span className="text-xs text-muted-foreground">No voucher code stored</span>
            {editable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs font-medium"
                onClick={() => setEditingCode(true)}
              >
                Add code
              </Button>
            )}
          </div>
        )
      )}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {copyError && <p className="text-xs text-destructive">Copy failed. Select and copy manually.</p>}

      {/* Expandable Set / Replace code form */}
      {editingCode && editable && (
        <div className="pt-2.5 border-t border-border/50">
          <SetCodeForm
            inst={inst}
            onCancel={() => setEditingCode(false)}
            onSaved={(v) => {
              setEditingCode(false);
              hide();
              applied(v);
            }}
          />
        </div>
      )}
    </div>
  );
}

function CodeRow({ label, value, action }: { label: string; value: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-muted/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="break-all font-mono text-sm font-medium text-foreground select-all">{value}</div>
      </div>
      {action}
    </div>
  );
}

function SetCodeForm({
  inst,
  onSaved,
  onCancel,
}: {
  inst: InstanceView;
  onSaved: (v: InstanceView) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateCode(value);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const view = await setCodeAction({ instanceId: inst.id, code: v.value });
      setValue('');
      setShow(false);
      onSaved(view);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the code.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2.5" noValidate>
      <div>
        <Label htmlFor={id} className="text-xs font-semibold text-foreground">
          {inst.hasCode ? 'Replace voucher code' : 'Add voucher code'}
        </Label>
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground mt-0.5">
          For card number and PIN, separate them with a space.
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste code or number PIN"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={500}
          className="h-9 text-xs"
          aria-describedby={`${id}-hint`}
          aria-invalid={error ? true : undefined}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide code input' : 'Show code input'}
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs font-medium" disabled={busy || value.trim() === ''}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save code
        </Button>
      </div>

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

// ── details (Read-only by default, Edit mode on demand) ───────────────────────

function toForm(i: InstanceView): DetailsForm {
  return {
    orderDate: i.orderDate ?? '',
    expiryDate: i.expiryDate ?? '',
    cashValue: i.cashValue ?? '',
    rupayBookingId: i.rupayBookingId ?? '',
    comments: i.comments ?? '',
  };
}

function DetailsSection({
  inst,
  editable,
  applied,
  reload,
}: {
  inst: InstanceView;
  editable: boolean;
  applied: (v: InstanceView) => void;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<DetailsForm>(() => toForm(inst));
  const [errors, setErrors] = React.useState<DetailsErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const uid = React.useId();

  const set = (k: keyof DetailsForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = validateDetails(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setServerError(null);
    setBusy(true);
    try {
      const v = await updateDetailsAction({ instanceId: inst.id, ...r.value });
      setForm(toForm(v));
      setEditing(false);
      applied(v);
    } catch (err) {
      setServerError(errorMessage(err));
      void reload();
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof DetailsForm, label: string, input: React.ReactNode) => (
    <div className="space-y-1">
      <Label htmlFor={`${uid}-${k}`} className="text-xs font-medium">
        {label}
      </Label>
      {input}
      {errors[k] && (
        <p id={`${uid}-${k}-err`} role="alert" className="text-[11px] text-destructive">
          {errors[k]}
        </p>
      )}
    </div>
  );

  const common = (k: keyof DetailsForm, customClass = 'h-9 text-xs') => ({
    id: `${uid}-${k}`,
    disabled: !editable || busy,
    className: customClass,
    'aria-invalid': errors[k] ? (true as const) : undefined,
    'aria-describedby': errors[k] ? `${uid}-${k}-err` : undefined,
  });

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">Booking & Details</h4>
        </div>
        {editable && !editing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3 w-3" /> Edit
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-border/40">
            <span className="text-muted-foreground">Order Date</span>
            <span className="font-medium text-foreground">{inst.orderDate ? formatDate(inst.orderDate) : '—'}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-border/40">
            <span className="text-muted-foreground">Expiry Date</span>
            <span className="font-medium text-foreground">{inst.expiryDate ? formatDate(inst.expiryDate) : '—'}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-border/40">
            <span className="text-muted-foreground">RuPay Booking ID</span>
            <span className="font-mono text-foreground">{inst.rupayBookingId || '—'}</span>
          </div>
          <div className="py-1">
            <span className="text-muted-foreground block mb-1">Comments / Notes</span>
            <p className="text-foreground/90 whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5 border border-border/40 text-[11px] leading-relaxed">
              {inst.comments || 'No notes added'}
            </p>
          </div>
        </div>
      ) : (
        <form aria-label="Details" className="space-y-3 pt-1" noValidate onSubmit={(e) => void submit(e)}>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {field('orderDate', 'Order date', <Input type="date" value={form.orderDate} onChange={set('orderDate')} {...common('orderDate')} />)}
            {field('expiryDate', 'Expiry date', <Input type="date" value={form.expiryDate} onChange={set('expiryDate')} {...common('expiryDate')} />)}
          </div>
          {field('cashValue', 'Cash value (₹)', <Input inputMode="decimal" value={form.cashValue} onChange={set('cashValue')} {...common('cashValue')} />)}
          {field('rupayBookingId', 'Booking ID', <Input value={form.rupayBookingId} onChange={set('rupayBookingId')} maxLength={200} {...common('rupayBookingId')} />)}
          {field('comments', 'Comments', <Textarea value={form.comments} onChange={set('comments')} maxLength={5000} {...common('comments', 'min-h-16 text-xs')} />)}

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setForm(toForm(inst));
                setEditing(false);
                setErrors({});
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs font-medium" disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save details
            </Button>
          </div>

          {serverError && <p role="alert" className="text-xs text-destructive">{serverError}</p>}
        </form>
      )}
    </div>
  );
}

// ── sale ────────────────────────────────────────────────────────────────────

function SaleSection({
  inst,
  applied,
  reload,
}: {
  inst: InstanceView;
  applied: (v: InstanceView) => void;
  reload: () => Promise<void>;
}) {
  const hasSale = inst.soldFor != null;
  const [value, setValue] = React.useState(inst.soldFor ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(hasSale);
  const id = React.useId();

  React.useEffect(() => {
    setValue(inst.soldFor ?? '');
    setExpanded(inst.soldFor != null);
  }, [inst.id, inst.soldFor]);

  if (!canRecordSale(inst.orderStatus)) return null;

  async function save(raw: string) {
    const p = parseMoney(raw);
    if (!p.ok) {
      setError(p.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const v = await recordSaleAction({ instanceId: inst.id, soldFor: p.value });
      setValue(v.soldFor ?? '');
      setExpanded(v.soldFor != null);
      applied(v);
    } catch (e) {
      setError(errorMessage(e));
      void reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-4 space-y-2.5 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <IndianRupee className="h-3.5 w-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">Sale Tracking</h4>
          </div>
        </div>
        {hasSale && !expanded && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(true)}
          >
            <Pencil className="h-3 w-3" /> Edit
          </Button>
        )}
      </div>

      {!expanded ? (
        <div className="flex items-center justify-between rounded-xl border border-dashed border-border/80 bg-muted/20 px-3.5 py-2.5">
          <span className="text-xs text-muted-foreground">
            {hasSale ? `Sold for ${formatMoney(inst.soldFor)}` : 'Did you sell this voucher?'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs font-medium text-primary hover:underline"
            onClick={() => setExpanded(true)}
          >
            {hasSale ? 'Edit sale' : 'Record sale'}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-2.5 pt-1"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save(value);
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={id} className="text-xs font-medium text-foreground">
              Amount received (₹)
            </Label>
            <Input
              id={id}
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 450"
              className="h-9 text-xs"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-err` : undefined}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              disabled={busy}
              onClick={() => {
                setValue(inst.soldFor ?? '');
                setExpanded(hasSale);
              }}
            >
              Cancel
            </Button>
            {hasSale && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs text-destructive hover:bg-destructive/10"
                disabled={busy}
                onClick={() => void save('')}
              >
                Clear sale
              </Button>
            )}
            <Button type="submit" size="sm" className="h-8 text-xs font-medium" disabled={busy || value.trim() === ''}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save sale
            </Button>
          </div>

          {error && <p id={`${id}-err`} role="alert" className="text-xs text-destructive">{error}</p>}
        </form>
      )}
    </div>
  );
}
