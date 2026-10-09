'use client';
import { Loader2 } from 'lucide-react';
import { deleteOverride, setOverrideActive } from '@/actions/overrides';
import { Button } from '@/components/ui/button';
import { ConfirmDelete, ErrorText, useRunAction } from '@/components/holders/form-kit';

export function OverrideToggle({ id, active, label }: { id: string; active: boolean; label: string }) {
  const { run, pending, error } = useRunAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`${active ? 'Turn off' : 'Turn on'} override ${label}`}
        onClick={() => run(() => setOverrideActive({ id, active: !active }), 'Could not update the override.')}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {active ? 'Turn off' : 'Turn on'}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function DeleteOverrideButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDelete
      label="override"
      name={name}
      warning="This permanently removes the override. If it has already generated benefits, it cannot be deleted; turn it off instead."
      failHint="Could not delete. The override has probably generated benefits; turn it off instead."
      onConfirm={() => deleteOverride({ id })}
    />
  );
}
