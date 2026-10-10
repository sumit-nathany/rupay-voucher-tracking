'use client';
import * as React from 'react';
import { AlertTriangle, Calendar, ChevronRight, CreditCard, Loader2, Mail, Pencil, Trash2, User } from 'lucide-react';
import { deleteHolder, updateHolder } from '@/actions/holders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ErrorText, Field, SubmitButton, useRunAction } from './form-kit';

export interface HolderCardSummary {
  id: string;
  displayName: string;
  lastDigits: string | null;
  bankCardTypeName: string;
  trackingFrom: string;
  active: boolean;
}

export interface HolderDetailData {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
}

export function HolderDetailSheet({
  holder,
  cards,
}: {
  holder: HolderDetailData;
  cards: HolderCardSummary[];
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'view' | 'edit' | 'delete'>('view');

  // Form edit state
  const { run, pending, error } = useRunAction();
  const [name, setName] = React.useState(holder.name);
  const [email, setEmail] = React.useState(holder.email ?? '');
  const [active, setActive] = React.useState(holder.active);

  // Sync state whenever holder props change or sheet opens
  React.useEffect(() => {
    if (open) {
      setName(holder.name);
      setEmail(holder.email ?? '');
      setActive(holder.active);
      setMode('view');
    }
  }, [open, holder]);

  const initial = holder.name.trim().charAt(0).toUpperCase() || '?';

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(
      () => updateHolder({ id: holder.id, name: name.trim(), email: email.trim() || null, active }),
      'Could not save holder. Check the name is unique and the email is valid.',
    );
    if (ok) {
      setMode('view');
    }
  }

  async function handleDelete() {
    const ok = await run(
      () => deleteHolder({ id: holder.id }),
      'Could not delete holder. Reassign or delete their cards first, or mark them inactive.',
    );
    if (ok) {
      setOpen(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="group w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
          aria-label={`View details for ${holder.name}`}
        >
          <Card className="h-full overflow-hidden border border-border/70 transition-all hover:border-foreground/25 hover:shadow-xs group-hover:bg-accent/20">
            <CardContent className="flex flex-row items-center justify-between gap-3.5 p-4 sm:p-5">
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <div
                  aria-hidden
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 text-base font-semibold text-primary shadow-xs transition-transform group-hover:scale-105"
                >
                  {initial}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-base leading-snug text-foreground group-hover:text-primary transition-colors">
                      {holder.name}
                    </span>
                    {holder.active === false ? (
                      <Badge variant="secondary" className="leading-none text-xs">
                        Inactive
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-normal text-xs leading-none">
                        Active
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                    {holder.email ? (
                      <span className="truncate max-w-[200px] inline-flex items-center gap-1 font-normal">
                        <Mail className="h-3 w-3 opacity-70" aria-hidden />
                        {holder.email}
                      </span>
                    ) : null}
                    <Badge variant="secondary" className="gap-1 font-normal text-xs px-2 py-0 h-5">
                      <CreditCard className="h-3 w-3 opacity-70" aria-hidden />
                      {cards.length} {cards.length === 1 ? 'card' : 'cards'}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center pl-1 text-muted-foreground group-hover:text-foreground">
                <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </div>
            </CardContent>
          </Card>
        </button>
      </SheetTrigger>

      <SheetContent>
        {mode === 'view' && (
          <div className="flex flex-1 flex-col justify-between">
            <div className="space-y-6">
              <SheetHeader>
                <div className="flex items-center gap-3.5">
                  <div
                    aria-hidden
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/25 text-lg font-bold text-primary shadow-xs"
                  >
                    {initial}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <SheetTitle className="text-xl font-bold leading-tight">{holder.name}</SheetTitle>
                      {holder.active === false ? (
                        <Badge variant="secondary" className="text-xs">
                          Inactive
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium text-xs">
                          Active
                        </Badge>
                      )}
                    </div>
                    <SheetDescription>Cardholder information and linked cards</SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-4">
                {/* Details Section */}
                <div className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact & Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" /> Email
                      </span>
                      <span className="font-medium text-foreground truncate max-w-[220px]">
                        {holder.email || <span className="text-muted-foreground font-normal">Not provided</span>}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" /> Status
                      </span>
                      <span className="font-medium text-foreground">
                        {holder.active ? 'Active — can be assigned cards' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 py-1">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <CreditCard className="h-3.5 w-3.5" /> Total Cards
                      </span>
                      <span className="font-semibold text-foreground">{cards.length}</span>
                    </div>
                  </div>
                </div>

                {/* Cards Section */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Attached Cards</span>
                    <Badge variant="secondary" className="text-xs px-2 py-0">
                      {cards.length}
                    </Badge>
                  </h4>

                  {cards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 p-5 text-center text-sm text-muted-foreground">
                      No cards attached to this holder yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {cards.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/50 p-3 text-sm"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                              <CreditCard className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">
                                {c.displayName}
                                {c.lastDigits ? <span className="text-muted-foreground font-normal ml-1.5 text-xs">(xx{c.lastDigits})</span> : null}
                              </p>
                              <p className="text-xs text-muted-foreground truncate flex items-center gap-2">
                                <span>{c.bankCardTypeName}</span>
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="h-3 w-3 opacity-70" /> since {c.trackingFrom}
                                </span>
                              </p>
                            </div>
                          </div>
                          {c.active === false && (
                            <Badge variant="secondary" className="shrink-0 text-xs">
                              Inactive
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <SheetFooter className="mt-8 pt-4 border-t border-border/50 flex flex-row items-center justify-between gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive border-border/70 gap-1.5"
                onClick={() => setMode('delete')}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
                <Button type="button" className="gap-1.5" onClick={() => setMode('edit')}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              </div>
            </SheetFooter>
          </div>
        )}

        {mode === 'edit' && (
          <form onSubmit={handleUpdate} className="flex flex-1 flex-col justify-between">
            <div className="space-y-5">
              <SheetHeader>
                <SheetTitle>Edit Holder</SheetTitle>
                <SheetDescription>Update holder name, email address, or active status.</SheetDescription>
              </SheetHeader>

              <div className="space-y-4">
                <Field id="edit-holder-name" label="Name">
                  <Input
                    id="edit-holder-name"
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                  />
                </Field>

                <Field id="edit-holder-email" label="Email (optional)">
                  <Input
                    id="edit-holder-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                  />
                </Field>

                <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 p-3 bg-muted/20">
                  <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                      aria-describedby="holder-active-hint"
                    />
                    Active
                  </label>
                  <p id="holder-active-hint" className="text-xs text-muted-foreground">
                    A holder who still has cards cannot be deleted; mark them inactive instead to stop tracking.
                  </p>
                </div>

                <ErrorText>{error}</ErrorText>
              </div>
            </div>

            <SheetFooter className="mt-8 pt-4 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setMode('view')}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>Save changes</SubmitButton>
            </SheetFooter>
          </form>
        )}

        {mode === 'delete' && (
          <div className="flex flex-1 flex-col justify-between">
            <div className="space-y-5">
              <SheetHeader>
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  <SheetTitle className="text-destructive">Delete Holder?</SheetTitle>
                </div>
                <SheetDescription>{holder.name}</SheetDescription>
              </SheetHeader>

              {cards.length > 0 ? (
                <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground space-y-2">
                  <p className="font-semibold text-warning-foreground flex items-center gap-1.5">
                    Cannot delete while cards exist
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {holder.name} currently has <strong>{cards.length} {cards.length === 1 ? 'card' : 'cards'}</strong> attached. Delete or reassign those cards first, or click Edit to mark this holder inactive.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground space-y-2">
                  <p className="font-semibold text-destructive">This action is permanent</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Deleting <strong>{holder.name}</strong> will remove them completely. This cannot be undone.
                  </p>
                </div>
              )}

              <ErrorText>{error}</ErrorText>
            </div>

            <SheetFooter className="mt-8 pt-4 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setMode('view')}>
                {cards.length > 0 ? 'Back to details' : 'Cancel'}
              </Button>
              {cards.length === 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={handleDelete}
                  className="gap-1.5"
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Delete permanently
                </Button>
              )}
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
