'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

/**
 * Short, user-safe message from a thrown server-action error.
 * In production Next.js redacts thrown messages from server actions, so a
 * redacted/unknown message falls back to the caller-supplied hint.
 */
export function messageFor(e: unknown, fallback: string): string {
  if (e instanceof Error) {
    const m = e.message.trim();
    if (m && m.length <= 300 && !/Server Components render|omitted in production|digest/i.test(m)) return m;
  }
  return fallback;
}

export function ErrorText({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

/** Sheet with a trigger button; content mounts only while open, so form state resets each time. */
export function FormSheet({
  trigger,
  triggerProps,
  title,
  description,
  children,
}: {
  trigger: React.ReactNode;
  triggerProps?: ButtonProps;
  title: string;
  description?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button {...triggerProps}>{trigger}</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description ?? ' '}</SheetDescription>
        </SheetHeader>
        {children(() => setOpen(false))}
      </SheetContent>
    </Sheet>
  );
}

/** Run an action, then refresh server data. Returns an error message or null. */
export function useRunAction() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError(messageFor(e, fallback));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { run, pending, error, setError };
}

export function ConfirmDelete({
  label,
  name,
  warning,
  disabledReason,
  onConfirm,
  failHint,
}: {
  label: string;
  name: string;
  warning: string;
  /** If set, delete is blocked up front and this explains why. */
  disabledReason?: string;
  onConfirm: () => Promise<unknown>;
  failHint: string;
}) {
  const { run, pending, error } = useRunAction();
  return (
    <FormSheet
      trigger={<>Delete</>}
      triggerProps={{ variant: 'ghost', size: 'sm', 'aria-label': `Delete ${label} ${name}` }}
      title={`Delete ${label}?`}
      description={name}
    >
      {(close) => (
        <div className="flex flex-1 flex-col gap-4">
          <p className="text-sm">{disabledReason ?? warning}</p>
          <ErrorText>{error}</ErrorText>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !!disabledReason}
              onClick={async () => {
                if (await run(onConfirm, failHint)) close();
              }}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Delete
            </Button>
          </SheetFooter>
        </div>
      )}
    </FormSheet>
  );
}
