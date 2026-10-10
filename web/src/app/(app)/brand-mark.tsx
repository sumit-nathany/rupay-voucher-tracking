import Link from 'next/link';

export function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-3 outline-none">
      <span
        aria-hidden
        className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-primary font-bold text-xl text-primary-foreground shadow-sm transition-transform duration-200 group-hover:scale-[1.03]"
      >
        ₹
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block font-bold text-xl tracking-tight text-foreground">RuPay</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Voucher desk
          </span>
        </span>
      )}
    </Link>
  );
}
