import { Card, CardContent } from '@/components/ui/card';
import type { DashboardSummary } from '@/domain/instance-queries';
import { formatINR } from './format';

// Each stat gets its own jewel colour so the row reads at a glance.
const BAND = {
  violet: 'bg-violet',
  gold: 'bg-gold',
  teal: 'bg-teal',
  indigo: 'bg-primary',
  rani: 'bg-rani',
} as const;

function Stat({
  label,
  value,
  hint,
  color,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  color: keyof typeof BAND;
  tone?: 'bad' | 'good';
}) {
  return (
    <Card className="overflow-hidden">
      <div className={`h-1.5 ${BAND[color]}`} aria-hidden />
      <CardContent className="p-4 sm:p-4">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div
          className={`mt-1 font-[family-name:var(--font-display)] text-xl font-semibold tabular-nums sm:text-2xl ${
            tone === 'bad' ? 'text-rani' : tone === 'good' ? 'text-teal' : ''
          }`}
        >
          {value}
        </div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function StatCards({ s }: { s: DashboardSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat color="violet" label="Outstanding" value={formatINR(s.outstandingValue)} hint="Not yet used or sold" />
      <Stat color="gold" label="Ordered" value={formatINR(s.orderedValue)} hint="Ordered or beyond" />
      <Stat color="teal" label="Redeemed" value={formatINR(s.redeemedValue)} tone="good" />
      <Stat color="indigo" label="Sold" value={formatINR(s.soldValue)} hint="Sale proceeds" />
      <Stat
        color="rani"
        label="Lapsed"
        value={formatINR(s.lapsedValue)}
        hint={`${s.lapsedCount} missed`}
        tone={s.lapsedCount > 0 ? 'bad' : undefined}
      />
    </div>
  );
}
