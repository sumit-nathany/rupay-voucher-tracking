'use client';

import * as React from 'react';
import { Pencil, Plus } from 'lucide-react';
import { createPortalAccountAction, updatePortalAccountAction } from '@/actions/automation';
import { Input } from '@/components/ui/input';
import { SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ErrorText, Field, FormSheet, SubmitButton, useRunAction } from '../holders/form-kit';
import { Label } from '@/components/ui/label';

export interface AccountRow {
  id: string;
  label: string;
  phoneNumber: string | null;
  status: 'connected' | 'paused' | 'credentials_expired' | 'challenge_required' | 'portal_changed' | 'needs_attention';
  hasCredentials: boolean;
}

function AccountFormBody({
  account,
  close,
}: {
  account?: AccountRow;
  close: () => void;
}) {
   const { run, pending, error } = useRunAction();
  const [label, setLabel] = React.useState(account?.label ?? '');
  const [phoneNumber, setPhoneNumber] = React.useState(account?.phoneNumber ?? '');
  const [loginId, setLoginId] = React.useState(account ? '' : ''); // empty when creating, but we don't show existing loginId for security
  const [password, setPassword] = React.useState('');
  const [pin, setPin] = React.useState(account ? '' : ''); // optional PIN

  const isCreate = !account;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(
      () =>
        isCreate
          ? createPortalAccountAction({
              label,
              phoneNumber: phoneNumber || undefined,
              credentials: {
                loginId,
                password,
                extra: pin ? { pin } : undefined,
              },
            })
          : updatePortalAccountAction({
              id: account!.id,
              label: label || undefined,
              phoneNumber: phoneNumber || null,
              credentials:
                loginId.trim() && password.trim()
                  ? {
                      loginId: loginId.trim(),
                      password: password.trim(),
                      extra: pin.trim() ? { pin: pin.trim() } : undefined,
                    }
                  : undefined,
            }),
      isCreate
        ? 'Could not create account. Check the label is unique and the credentials are valid.'
        : 'Could not save account. Check the label is unique.',
    );
    if (ok) close();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4">
      <Field id="account-label" label="Label">
        <Input id="account-label" required maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="account-phoneNumber" label="Registered Mobile Number (optional)">
        <Input
          id="account-phoneNumber"
          type="tel"
          placeholder="e.g. 9876543210"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Mobile number registered with this RuPay account, used on payment gateways during checkout.
        </p>
      </Field>

       {!isCreate && (
         <div className="space-y-4">
           <div className="space-y-1.5">
             <Label htmlFor="sheet-loginId" className="text-xs font-medium">
               New Login ID / Email (optional)
             </Label>
             <Input
               id="sheet-loginId"
               name="loginId"
               placeholder="Leave blank to keep existing"
               value={loginId}
               onChange={(e) => setLoginId(e.target.value)}
               className="h-9 text-sm bg-background"
             />
           </div>

           <div className="space-y-1.5">
             <Label htmlFor="sheet-password" className="text-xs font-medium">
               New Portal Password (optional)
             </Label>
             <Input
               id="sheet-password"
               name="password"
               type="password"
               placeholder="Leave blank to keep existing"
               value={password}
               onChange={(e) => setPassword(e.target.value)}
               className="h-9 text-sm bg-background"
             />
           </div>

           <div className="space-y-1.5">
             <Label htmlFor="sheet-pin" className="text-xs font-medium">
               New Portal PIN (optional)
             </Label>
             <Input
               id="sheet-pin"
               name="pin"
               placeholder="Optional portal PIN"
               value={pin}
               onChange={(e) => setPin(e.target.value)}
               className="h-9 text-sm bg-background"
             />
           </div>
         </div>
       )}

       {isCreate && (
         <div className="space-y-4">
           <div className="space-y-1.5">
             <Label htmlFor="sheet-loginId" className="text-xs font-medium">
               Login ID / Email
             </Label>
             <Input
               id="sheet-loginId"
               name="loginId"
               placeholder="e.g. 9876543210 or email"
               required
               value={loginId}
               onChange={(e) => setLoginId(e.target.value)}
               className="h-9 text-sm"
             />
           </div>

           <div className="space-y-1.5">
             <Label htmlFor="sheet-password" className="text-xs font-medium">
               Password
             </Label>
             <Input
               id="sheet-password"
               name="password"
               type="password"
               required
               value={password}
               onChange={(e) => setPassword(e.target.value)}
               className="h-9 text-sm"
             />
           </div>

           <div className="space-y-1.5">
             <Label htmlFor="sheet-pin" className="text-xs font-medium">
               Security PIN (optional)
             </Label>
             <Input
               id="sheet-pin"
               name="pin"
               placeholder="Optional portal PIN"
               value={pin}
               onChange={(e) => setPin(e.target.value)}
               className="h-9 text-sm"
             />
           </div>
         </div>
       )}

      <ErrorText>{error}</ErrorText>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>
          {isCreate ? 'Add account' : 'Save changes'}
        </SubmitButton>
      </SheetFooter>
    </form>
  );
}

export function AccountFormSheet({ account }: { account?: AccountRow }) {
  return account ? (
    <FormSheet
      trigger={<Pencil className="h-4 w-4" aria-hidden />}
      triggerProps={{
        variant: 'ghost',
        size: 'icon',
        className: 'h-8 w-8 text-muted-foreground hover:text-foreground',
        'aria-label': `Edit account ${account.label}`,
      }}
      title="Edit account"
    >
      {(close) => <AccountFormBody account={account} close={close} />}
    </FormSheet>
  ) : (
    <FormSheet
      trigger={<><Plus className="h-4 w-4" aria-hidden />Add account</>}
      title="Add account"
      description="RuPay portal account used for automated ordering."
    >
      {(close) => <AccountFormBody close={close} />}
    </FormSheet>
  );
}