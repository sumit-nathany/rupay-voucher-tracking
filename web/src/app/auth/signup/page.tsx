import { LoginForm } from '@/components/auth/login-form';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="min-h-dvh">
      <div className="grid min-h-dvh lg:grid-cols-2">
        {/* Brand panel */}
        <section className="relative flex flex-col justify-between border-r border-border bg-sidebar p-8 sm:p-12 lg:p-14">
          <div>
            <span className="eyebrow">RuPay benefits</span>
          </div>
          <div className="max-w-lg py-12 lg:py-0">
            <span
              aria-hidden
              className="mb-8 inline-grid h-16 w-16 place-items-center rounded-2xl bg-primary font-semibold tracking-tight text-4xl text-primary-foreground shadow-md"
            >
              ₹
            </span>
            <h1 className="font-semibold tracking-tight text-4xl leading-[1.05] text-foreground sm:text-5xl lg:text-6xl">
              Your voucher desk
            </h1>
            <div className="my-8 h-px max-w-xs bg-border" />
            <p className="text-lg leading-relaxed text-muted-foreground">
              Track every RuPay benefit from order to redemption — by holder, by card, by quarter.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">RuPay Voucher Tracking</p>
        </section>

        {/* Signup panel */}
        <section className="flex items-center justify-center px-4 py-12 sm:px-10 bg-background">
          <div className="w-full max-w-md">
            <div className="rounded-xl border border-border bg-card p-8 shadow-sm sm:p-10">
              <h2 className="font-semibold tracking-tight text-3xl">Create account</h2>
              <p className="mt-2 mb-6 text-sm text-muted-foreground">
                Enter your email and create a password to get started.
              </p>
              <LoginForm initialError={error} defaultMode="signup" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
