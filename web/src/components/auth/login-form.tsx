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

export function LoginForm({
  initialError,
  defaultMode = 'signin',
}: {
  initialError?: string;
  defaultMode?: 'signin' | 'signup';
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>(defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(messageForCode(initialError));
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const trimmed = email.trim().toLowerCase();

      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmed,
          password,
        });

        if (signUpError) {
          setError(mapAuthError(signUpError.message, signUpError.status));
          return;
        }

        // If user is auto-confirmed or session is returned:
        if (data.session) {
          const boot = await bootstrapSessionAction();
          if (!boot.ok) {
            await supabase.auth.signOut();
            setError(boot.message);
            return;
          }
          router.push('/');
          router.refresh();
          return;
        }

        // Email confirmation is required
        setSuccess('Account created! Please check your email to confirm your account.');
        return;
      }

      // Mode: signin
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });

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
    <div className="space-y-4">
      {/* Mode switcher tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => {
            setMode('signin');
            setError(null);
            setSuccess(null);
          }}
          className={`rounded-md py-1.5 transition-colors ${
            mode === 'signin'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('signup');
            setError(null);
            setSuccess(null);
          }}
          className={`rounded-md py-1.5 transition-colors ${
            mode === 'signup'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={onSubmit} action="#" method="post" className="space-y-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {success && (
          <p
            role="status"
            className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400"
          >
            {success}
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
            placeholder="you@example.com"
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
            minLength={6}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
        </div>

        <Button type="submit" className="mt-2 w-full" size="lg" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />{' '}
              {mode === 'signup' ? 'Creating account…' : 'Signing in…'}
            </>
          ) : mode === 'signup' ? (
            'Create account'
          ) : (
            'Sign in'
          )}
        </Button>
      </form>
    </div>
  );
}

function messageForCode(code?: string): string | null {
  if (!code) return null;
  if (code === 'invalid_credentials') return 'Wrong email or password.';
  if (code === 'invalid_link')
    return 'This sign-in link is invalid or expired. Request a new invite from your admin.';
  if (code === 'setup_failed')
    return 'Signed in, but your workspace could not be created. Check the database connection and try again.';
  return 'Could not sign in. Try again.';
}
