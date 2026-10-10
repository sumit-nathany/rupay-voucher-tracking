// Pure: RuPay portal responses -> catalog benefits. See docs/rupay-portal-api.md for field meanings.

export type Frequency = "Annual" | "6 months" | "Quarterly" | "Monthly";

/** One `getCardServices` item (a benefit category). */
export interface PortalService {
  id: number | string;
  servicename: string;
  ddescription?: string | null;
  description?: string | null;
}

/** One `getUserDealsNew` item (an offer inside a category). */
export interface PortalDeal {
  servicename: string;
  spname: string;
  productname: string;
  cvalidity: string;
  complimentaryCount?: number | string | null;
  netrate?: number | string | null;
  startdate: string;
  enddate?: string | null;
  productid?: number | string | null;
}

export interface OptionOut {
  provider: string;
  offerName: string;
  cashValue: number | null;
  portalOfferId: number | null;
}

export interface BenefitOut {
  benefitType: string;
  /** null for a "redeem any one" benefit: the provider is chosen per period. */
  benefitProvider: string | null;
  exactBenefit: string;
  frequency: Frequency;
  instanceCount: number;
  defaultCashValue: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Non-empty only for a "redeem any one" benefit. */
  options: OptionOut[];
}

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", mdash: "-", ndash: "-" };

/** Strip HTML tags and entities, collapse whitespace. */
export function cleanText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const FREQ: Record<string, Frequency> = {
  yearly: "Annual",
  annual: "Annual",
  "half-yearly": "6 months",
  "half yearly": "6 months",
  quarterly: "Quarterly",
  monthly: "Monthly",
};

export function mapFrequency(v: string): Frequency | null {
  return FREQ[cleanText(v).toLowerCase()] ?? null;
}

/** The portal marks pick-one categories only in prose ("Choose & redeem any one of the below offers"). */
export function isPickOne(service: PortalService): boolean {
  return /\bany one\b/i.test(cleanText(service.ddescription) + " " + cleanText(service.description));
}

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const numOrNull = (v: unknown) => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};
const count = (d: PortalDeal) => Math.max(1, Math.trunc(numOrNull(d.complimentaryCount) ?? 1));

function mostCommon<T>(xs: T[]): T {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Rule (agreed 2026-10-10): a category the portal labels "redeem any one" with
 * more than one offer becomes ONE benefit whose offers are options. Every other
 * offer is its own benefit.
 */
export function transformCard(
  services: PortalService[],
  dealsByService: Map<string, PortalDeal[]>,
): { benefits: BenefitOut[]; warnings: string[] } {
  const benefits: BenefitOut[] = [];
  const warnings: string[] = [];

  for (const svc of services) {
    const type = cleanText(svc.servicename);
    const deals: (PortalDeal & { freq: Frequency })[] = [];
    for (const d of dealsByService.get(String(svc.id)) ?? []) {
      let freq = mapFrequency(d.cvalidity);
      // RuPay API quirk: Kalyan Jewellery offline half-yearly offer specifies cvalidity: "Quarterly"
      // even though productname specifies Half-Yearly and is redeemable once per 6 months (H1 and H2).
      if (/half[-\s]?yearly/i.test(d.productname) || /kalyan/i.test(d.productname) || /kalyan/i.test(d.spname)) {
        freq = "6 months";
      }
      if (!freq) {
        warnings.push(`${type} / ${cleanText(d.productname)}: unknown validity "${d.cvalidity}", skipped`);
        continue;
      }
      deals.push({ ...d, freq });
    }
    if (deals.length === 0) continue;

    if (isPickOne(svc) && deals.length > 1) {
      const freqs = deals.map((d) => d.freq);
      const frequency = mostCommon(freqs);
      if (new Set(freqs).size > 1) warnings.push(`${type}: offers have mixed validity, using ${frequency}`);
      const values = deals.map((d) => numOrNull(d.netrate)).filter((v): v is number => v != null);
      benefits.push({
        benefitType: type,
        benefitProvider: null,
        exactBenefit: `Any one of ${deals.length} offers`,
        frequency,
        instanceCount: Math.max(...deals.map(count)),
        // Highest offer value: what the holder can get by choosing well.
        defaultCashValue: values.length ? Math.max(...values) : null,
        effectiveFrom: deals.map((d) => day(d.startdate)!).sort()[0],
        // The portal's enddate is a promo window that rolls forward yearly, not a real end.
        // Leaving it null keeps the benefit generating past 2026 (fixed 2026-10-10).
        effectiveTo: null,
        options: deals
          .map((d) => ({
            provider: cleanText(d.spname),
            offerName: cleanText(d.productname),
            cashValue: numOrNull(d.netrate),
            portalOfferId: numOrNull(d.productid),
          }))
          .sort((a, b) => a.provider.localeCompare(b.provider)),
      });
      continue;
    }

    for (const d of deals) {
      benefits.push({
        benefitType: type,
        benefitProvider: cleanText(d.spname) || null,
        exactBenefit: cleanText(d.productname),
        frequency: d.freq,
        instanceCount: count(d),
        defaultCashValue: numOrNull(d.netrate),
        effectiveFrom: day(d.startdate)!,
        effectiveTo: null, // see note above: portal enddate is a rolling promo window, not a discontinuation

        options: [],
      });
    }
  }
  return { benefits, warnings };
}
