import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setPassword } from '../actions';

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string }> }) {
  const { error, reason } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set your password</CardTitle>
          <CardDescription>At least 6 characters. You will use it to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={setPassword} className="space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-rani/40 bg-rani/10 px-3 py-2 text-sm text-rani">
                {error === 'mismatch'
                  ? 'The two passwords do not match. Enter the same password in both boxes.'
                  : `Could not set the password. ${reason ?? 'Try again.'}`}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" minLength={6} required autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input id="confirm" name="confirm" type="password" minLength={6} required autoComplete="new-password" />
            </div>
            <Button type="submit" className="w-full">
              Save password
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
