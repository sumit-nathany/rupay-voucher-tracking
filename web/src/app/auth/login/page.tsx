import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn } from '../actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative flex flex-col justify-end overflow-hidden bg-gradient-to-br from-ink via-ink-2 to-[#5a2a8c] p-8 text-white sm:p-12 lg:justify-center">
        <div aria-hidden className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-gold/25 blur-3xl" />
        <div aria-hidden className="absolute -bottom-24 left-10 h-72 w-72 rounded-full bg-rani/30 blur-3xl" />
        <div className="relative max-w-md py-10 lg:py-0">
          <span
            aria-hidden
            className="mb-6 grid h-12 w-12 place-items-center rounded-xl bg-gold font-[family-name:var(--font-display)] text-2xl font-bold text-ink"
          >
            ₹
          </span>
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">RuPay Voucher Tracker</h1>
          <div className="ornament my-5 max-w-40" />
          <p className="text-base text-white/80">Every card, every benefit, every voucher. Used before it lapses.</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold">Welcome back</h2>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">Sign in to see your benefits.</p>
          <form action={signIn} className="space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-rani/40 bg-rani/10 px-3 py-2 text-sm text-rani">
                Wrong email or password.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" size="lg">
              Sign in
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
