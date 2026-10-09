import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(232,148,26,0.25),transparent)]"
      />
      <div className="grid min-h-dvh lg:grid-cols-2">
        <section className="app-sidebar relative flex flex-col justify-between p-8 sm:p-12 lg:p-14">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }} />
          <div className="relative">
            <span className="eyebrow text-white/45">RuPay benefits</span>
          </div>
          <div className="relative max-w-lg py-12 lg:py-0">
            <span
              aria-hidden
              className="mb-8 inline-grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-gold to-[#f5c56a] font-semibold tracking-tight text-4xl text-ink shadow-[0_20px_50px_-20px_rgba(232,148,26,0.9)]"
            >
              ₹
            </span>
            <h1 className="font-semibold tracking-tight text-4xl leading-[1.05] text-white sm:text-5xl lg:text-6xl">
              Your voucher desk
            </h1>
            <div className="ornament my-8 max-w-xs" />
            <p className="text-lg leading-relaxed text-white/75">
              Track every RuPay benefit from order to redemption — by holder, by card, by quarter.
            </p>
          </div>
          <p className="relative text-xs text-white/40">Invite-only · Supabase Auth</p>
        </section>

        <section className="app-canvas flex items-center justify-center px-4 py-12 sm:px-10">
          <div className="w-full max-w-md">
            <div className="content-stage !p-8 sm:!p-10">
              <h2 className="font-semibold tracking-tight text-3xl">Sign in</h2>
              <p className="mt-2 text-sm text-muted-foreground">Use the email and password from your invite.</p>
              <p className="mb-6 mt-4 rounded-xl bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                First time? Open your <strong className="font-medium text-foreground">invite email</strong>, set a password, then return here.
              </p>
              <LoginForm initialError={error} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
