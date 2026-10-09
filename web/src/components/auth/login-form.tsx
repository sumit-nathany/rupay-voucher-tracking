'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { bootstrapSessionAction } from '@/app/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mapAuthError } from '@/lib/auth-errors';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(messageForCode(initialError));
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const trimmed = email.trim().toLowerCase();
      const { error: authError } = await supabase.auth.signInWithPassword({ email: trimmed, password });
      if (authError) {
        setError(mapAuthError(authError.message, authError.status));
        return;
      }
      const boot = await bootstrapSessionAction();
      if (!boot.ok) {
        await supabase.auth.signOut();
        setError(boot.message);
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
      </div>
      <Button type="submit" className="mt-2 w-full" size="lg" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Signing in…
          </>
        ) : (
          'Sign in'
        )}
      </Button>
    </form>
  );
}

function messageForCode(code?: string): string | null {
  if (!code) return null;
  if (code === 'invalid_credentials') return 'Wrong email or password.';
  if (code === 'invalid_link') return 'This sign-in link is invalid or expired. Request a new invite from your admin.';
  if (code === 'setup_failed') return 'Signed in, but your workspace could not be created. Check the database connection and try again.';
  return 'Could not sign in. Try again.';
}
