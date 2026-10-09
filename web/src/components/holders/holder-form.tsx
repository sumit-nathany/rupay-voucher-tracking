'use client';
import * as React from 'react';
import { Pencil, Plus } from 'lucide-react';
import { createHolder, updateHolder } from '@/actions/holders';
import { Input } from '@/components/ui/input';
import { SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorText, Field, FormSheet, SubmitButton, useRunAction } from './form-kit';

export interface HolderRow {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
}

function HolderFormBody({ holder, close }: { holder?: HolderRow; close: () => void }) {
  const { run, pending, error } = useRunAction();
  const [name, setName] = React.useState(holder?.name ?? '');
  const [email, setEmail] = React.useState(holder?.email ?? '');
  const [active, setActive] = React.useState(holder?.active ?? true);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(
      () =>
        holder
          ? updateHolder({ id: holder.id, name, email, active })
          : createHolder({ name, email }),
      'Could not save. Check the name is unique and the email is valid.',
    );
    if (ok) close();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4">
      <Field id="holder-name" label="Name">
        <Input id="holder-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="holder-email" label="Email (optional)">
        <Input id="holder-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      </Field>
      {holder && (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              aria-describedby="holder-active-hint"
            />
            Active
          </label>
          <p id="holder-active-hint" className="text-xs text-muted-foreground">
            A holder who still has cards cannot be deleted; mark them inactive instead.
          </p>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>{holder ? 'Save changes' : 'Add holder'}</SubmitButton>
      </SheetFooter>
    </form>
  );
}

export function HolderFormSheet({ holder }: { holder?: HolderRow }) {
  return holder ? (
    <FormSheet
      trigger={<><Pencil className="h-4 w-4" aria-hidden />Edit</>}
      triggerProps={{ variant: 'outline', size: 'sm', 'aria-label': `Edit holder ${holder.name}` }}
      title="Edit holder"
    >
      {(close) => <HolderFormBody holder={holder} close={close} />}
    </FormSheet>
  ) : (
    <FormSheet
      trigger={<><Plus className="h-4 w-4" aria-hidden />Add holder</>}
      title="Add holder"
      description="A person whose cards you track."
    >
      {(close) => <HolderFormBody close={close} />}
    </FormSheet>
  );
}
