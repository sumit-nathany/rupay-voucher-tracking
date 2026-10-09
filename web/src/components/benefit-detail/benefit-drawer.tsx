'use client';

import * as React from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import {
  chooseOptionAction,
  getInstanceAction,
  getInstanceOptionsAction,
  recordSaleAction,
  revealCodeAction,
  setCodeAction,
  setStatusAction,
  skipInstanceAction,
  unskipInstanceAction,
  updateDetailsAction,
} from '@/actions/instances';
import type { BenefitOptionView, InstanceView, OrderStatus, RevealedCode } from '@/domain/instances';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  AUTO_HIDE_MS,
  CODE_MASK,
  COPIED_MS,
  WORKFLOW_STATUSES,
  canEdit,
  canRecordSale,
  canSkip,
  errorMessage,
  formatDate,
  formatMoney,
  neighbours,
  parseMoney,
  statusKind,
  validateCode,
  validateDetails,
  workflowIndex,
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
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async (id: string, isCurrent: () => boolean) => {
    setLoading(true);
    setLoadError(null);
    try {
      const v = await getInstanceAction(id);
      if (isCurrent()) setInst(v);
    } catch (e) {
      if (isCurrent()) setLoadError(errorMessage(e, 'Could not load this benefit.'));
    } finally {
      if (isCurrent()) setLoading(false);
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
      <SheetContent aria-describedby="benefit-drawer-desc" className="gap-5">
        <SheetHeader>
          <SheetTitle>{title ?? 'Benefit details'}</SheetTitle>
          <SheetDescription id="benefit-drawer-desc">
            {inst ? `${subtitle ? `${subtitle} · ` : ''}${inst.periodLabel}${inst.instanceNumber > 1 ? ` · #${inst.instanceNumber}` : ''}` : 'Loading…'}
          </SheetDescription>
        </SheetHeader>

        {loadError ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-destructive">{loadError}</p>
            {instanceId && (
              <Button variant="outline" size="sm" onClick={() => void load(instanceId, () => true)}>
                Retry
              </Button>
            )}
          </div>
        ) : !inst ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Loading…
          </p>
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
    <div className="flex flex-col gap-6 pb-2">
      <Summary inst={inst} />

      <OptionSection inst={inst} editable={editable} applied={applied} />

      {kind === 'withdrawn' ? (
        <div className="rounded-md border border-dashed bg-muted/40 p-3 text-sm" role="note">
          <p className="font-medium">Withdrawn</p>
          <p className="mt-1 text-muted-foreground">
            This benefit is no longer active for this card: the bank dropped it, or it was suppressed (or its added
            benefit was turned off) in the catalog overrides. The app set this status automatically, so it can&apos;t be
            changed here. If the benefit becomes active again, it returns to Not Ordered by itself. Nothing on this
            instance can be edited.
          </p>
        </div>
      ) : (
        <StatusSection inst={inst} applied={applied} reload={reload} />
      )}

      <CodeSection inst={inst} open={open} editable={editable} applied={applied} />

      {kind === 'workflow' && <SaleSection key={`s-${String(inst.updatedAt)}`} inst={inst} applied={applied} reload={reload} />}

      <DetailsSection key={`d-${String(inst.updatedAt)}`} inst={inst} editable={editable} applied={applied} reload={reload} />
    </div>
  );
}

function statusVariant(s: string): React.ComponentProps<typeof Badge>['variant'] {
  if (s === 'Coupon Redeemed') return 'success';
  if (s === 'Ordered but Coupon not received') return 'warning';
  if (s === 'Withdrawn') return 'destructive';
  return 'secondary';
}

function Summary({ inst }: { inst: InstanceView }) {
  const rows: [string, string][] = [
    ['Period', inst.periodLabel],
    ['Order deadline', formatDate(inst.orderDeadline)],
    ['Value', formatMoney(inst.cashValue)],
    ['Sold for', inst.soldFor != null ? formatMoney(inst.soldFor) : '—'],
  ];
  return (
    <section aria-label="Summary" className="space-y-3">
      <Badge variant={statusVariant(inst.orderStatus)} className={cn(inst.orderStatus === 'Withdrawn' && 'line-through')}>
        {inst.orderStatus}
      </Badge>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ── "redeem any one" choice ─────────────────────────────────────────────────

/** Only rendered for a benefit whose catalog version lists offers to choose from. */
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
    <section aria-labelledby={`${id}-h`} className="space-y-2 rounded-md border border-gold/50 bg-gold-soft/40 p-3">
      <h3 id={`${id}-h`} className="text-sm font-semibold">
        Choose any one of {options.length} offers
      </h3>
      <p className="text-xs text-muted-foreground">This benefit gives one redemption this period. Pick the offer you took.</p>
      <Label htmlFor={id} className="sr-only">
        Offer taken
      </Label>
      <select
        id={id}
        className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:text-sm"
        value={inst.chosenOptionId ?? ''}
        disabled={busy || !editable}
        onChange={(e) => void choose(e.target.value)}
      >
        <option value="">Not chosen yet</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.provider}: {o.offerName}
            {o.cashValue != null ? ` (${formatMoney(o.cashValue)})` : ''}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

// ── status ──────────────────────────────────────────────────────────────────

function StatusSection({
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
  const { prev, next } = neighbours(inst.orderStatus);
  const current = workflowIndex(inst.orderStatus);

  async function run(fn: () => Promise<InstanceView>) {
    setBusy(true);
    setError(null);
    try {
      applied(await fn());
    } catch (e) {
      setError(errorMessage(e));
      void reload(); // stale state (e.g. concurrent change): show the truth
    } finally {
      setBusy(false);
    }
  }
  const move = (status: OrderStatus) => run(() => setStatusAction({ instanceId: inst.id, status }));

  return (
    <section aria-label="Status" className="space-y-3">
      <h3 className="text-sm font-semibold">Status</h3>

      {kind === 'skipped' ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">You skipped this benefit. Unskip to track it again.</p>
          <Button variant="outline" disabled={busy} onClick={() => void run(() => unskipInstanceAction(inst.id))}>
            Unskip (back to Not Ordered)
          </Button>
        </div>
      ) : (
        <>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-1" aria-label="Workflow steps">
            {WORKFLOW_STATUSES.map((s, i) => {
              const isCurrent = i === current;
              return (
                <li key={s}>
                  <button
                    type="button"
                    disabled={busy || isCurrent}
                    aria-current={isCurrent ? 'step' : undefined}
                    onClick={() => void move(s)}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isCurrent
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:bg-accent disabled:opacity-50',
                      i < current && 'text-muted-foreground',
                    )}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs" aria-hidden>
                      {i < current ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span>{s}</span>
                    {isCurrent && <span className="sr-only"> (current)</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy || !prev} onClick={() => prev && void move(prev)}>
              <ChevronLeft className="h-4 w-4" aria-hidden /> Back
            </Button>
            <Button size="sm" disabled={busy || !next} onClick={() => next && void move(next)}>
              Next <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            {canSkip(inst.orderStatus) && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => skipInstanceAction(inst.id))}>
                Skip
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
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
  // Plaintext lives ONLY in this state. It is cleared on hide, timeout, close and unmount.
  const [revealed, setRevealed] = React.useState<RevealedCode | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<CopyKey | null>(null);
  const [copyError, setCopyError] = React.useState(false);
  const generation = React.useRef(0); // invalidates in-flight reveals
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = React.useCallback(() => {
    generation.current += 1;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setRevealed(null);
    setRevealing(false);
  }, []);

  // Hide on close and on unmount; also if the code is gone/changed.
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
      if (gen !== generation.current) return; // closed / hidden meanwhile: drop it
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
    <Button variant="outline" size="sm" onClick={() => void copy(text, k)} aria-label={`Copy ${label}`}>
      {copied === k ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {copied === k ? 'Copied' : 'Copy'}
    </Button>
  );

  return (
    <section aria-label="Voucher code" className="space-y-3">
      <h3 className="text-sm font-semibold">Voucher code</h3>

      {inst.hasCode ? (
        revealed ? (
          <div className="space-y-2">
            {revealed.number != null && revealed.pin != null ? (
              <>
                <CodeRow label="Number" value={revealed.number} action={<CopyBtn text={revealed.number} k="number" label="number" />} />
                <CodeRow label="PIN" value={revealed.pin} action={<CopyBtn text={revealed.pin} k="pin" label="PIN" />} />
              </>
            ) : (
              <CodeRow label="Code" value={revealed.code} action={<CopyBtn text={revealed.code} k="code" label="code" />} />
            )}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={hide}>
                <EyeOff className="h-4 w-4" aria-hidden /> Hide
              </Button>
              <span className="text-xs text-muted-foreground">Hides automatically after 30 seconds.</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <span className="font-mono text-lg tracking-widest" aria-label="Code hidden">
              {CODE_MASK}
            </span>
            <Button variant="outline" size="sm" disabled={revealing} onClick={() => void reveal()}>
              {revealing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              Reveal
            </Button>
          </div>
        )
      ) : (
        <p className="text-sm text-muted-foreground">No code saved.</p>
      )}

      <div aria-live="polite" className="min-h-4 text-sm">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {copyError && <p className="text-destructive">Copy failed. Select the text and copy manually.</p>}
      </div>

      {editable && (
        <SetCodeForm
          inst={inst}
          onSaved={(v) => {
            hide(); // any revealed value is now stale
            applied(v);
          }}
        />
      )}
    </section>
  );
}

function CodeRow({ label, value, action }: { label: string; value: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="break-all font-mono text-base">{value}</div>
      </div>
      {action}
    </div>
  );
}

function SetCodeForm({ inst, onSaved }: { inst: InstanceView; onSaved: (v: InstanceView) => void }) {
  const [value, setValue] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const id = React.useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
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
      setSaved(true);
      onSaved(view);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the code.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2" noValidate>
      <Label htmlFor={id}>{inst.hasCode ? 'Replace code' : 'Add code'}</Label>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        For card number and PIN, separate them with a space.
      </p>
      <div className="flex gap-2">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={500}
          aria-describedby={`${id}-hint`}
          aria-invalid={error ? true : undefined}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide code input' : 'Show code input'}
          aria-pressed={show}
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || value.trim() === ''}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save code
        </Button>
        {saved && <span className="text-sm text-success" role="status">Saved</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
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
  const [value, setValue] = React.useState(inst.soldFor ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();

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
      applied(v);
    } catch (e) {
      setError(errorMessage(e));
      void reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Record sale"
      className="space-y-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(value);
      }}
    >
      <h3 className="text-sm font-semibold">Sale</h3>
      <Label htmlFor={id}>Sold for (₹)</Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="0.00"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || value.trim() === ''}>
          Record sale
        </Button>
        {inst.soldFor != null && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void save('')}>
            Clear sale
          </Button>
        )}
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

// ── details ─────────────────────────────────────────────────────────────────

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
  const [form, setForm] = React.useState<DetailsForm>(() => toForm(inst));
  const [errors, setErrors] = React.useState<DetailsErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const uid = React.useId();

  const set = (k: keyof DetailsForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
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
      setSaved(true);
      applied(v);
    } catch (err) {
      setServerError(errorMessage(err));
      void reload();
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof DetailsForm, label: string, input: React.ReactNode) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${uid}-${k}`}>{label}</Label>
      {input}
      {errors[k] && (
        <p id={`${uid}-${k}-err`} role="alert" className="text-sm text-destructive">
          {errors[k]}
        </p>
      )}
    </div>
  );
  const common = (k: keyof DetailsForm) => ({
    id: `${uid}-${k}`,
    disabled: !editable || busy,
    'aria-invalid': errors[k] ? (true as const) : undefined,
    'aria-describedby': errors[k] ? `${uid}-${k}-err` : undefined,
  });

  return (
    <form aria-label="Details" className="space-y-3" noValidate onSubmit={(e) => void submit(e)}>
      <h3 className="text-sm font-semibold">Details</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('orderDate', 'Order date', <Input type="date" value={form.orderDate} onChange={set('orderDate')} {...common('orderDate')} />)}
        {field('expiryDate', 'Expiry date', <Input type="date" value={form.expiryDate} onChange={set('expiryDate')} {...common('expiryDate')} />)}
      </div>
      {field('cashValue', 'Cash value (₹)', <Input inputMode="decimal" value={form.cashValue} onChange={set('cashValue')} {...common('cashValue')} />)}
      {field('rupayBookingId', 'Booking ID', <Input value={form.rupayBookingId} onChange={set('rupayBookingId')} maxLength={200} {...common('rupayBookingId')} />)}
      {field('comments', 'Comments', <Textarea value={form.comments} onChange={set('comments')} maxLength={5000} {...common('comments')} />)}
      {editable && (
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save details
          </Button>
          {saved && <span className="text-sm text-success" role="status">Saved</span>}
        </div>
      )}
      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}
    </form>
  );
}
