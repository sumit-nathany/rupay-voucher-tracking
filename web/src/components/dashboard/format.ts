const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export const formatINR = (n: number) => INR.format(n);

const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** 'YYYY-MM-DD' -> '9 Oct 2026' (UTC so no timezone shift). */
export const formatDate = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));
