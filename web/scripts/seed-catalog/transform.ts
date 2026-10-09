// Pure transform: raw sheet rows -> shared-catalog seed data + entitlement-period instances.
// Implements PLAN.md "Import normalization rules" 5-11, 13 and "Entitlement periods".
// (Rules 1-4 are applied by reader.ts; rule 12/14 belong to the DB write layer.)
import {
  BankCardTypeOut,
  BenefitOut,
  DiscardedRow,
  Frequency,
  InstanceOut,
  OrderStatus,
  PhysicalCardOut,
  RawRow,
  SkippedMonthlyRow,
  TransformResult,
  VersionOut,
} from "./types";

const FREQUENCIES: readonly Frequency[] = ["Annual", "Quarterly", "6 months", "Monthly"];
const STATUS_RANK: Record<OrderStatus, number> = {
  "Not Ordered": 0,
  "Ordered but Coupon not received": 1,
  "Coupon Received": 2,
  "Coupon Redeemed": 3,
};

// ---------- date helpers (calendar quarters, per PLAN.md entitlement table) ----------
const pad = (n: number) => String(n).padStart(2, "0");
/** Quarter ordinal: cy*4 + (q-1). */
const ordinal = (cy: number, q: number) => cy * 4 + (q - 1);
const ordYear = (o: number) => Math.floor(o / 4);
const ordQ = (o: number) => (o % 4) + 1;
const quarterStart = (o: number) => `${ordYear(o)}-${pad((ordQ(o) - 1) * 3 + 1)}-01`;
function monthEnd(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
const quarterEnd = (o: number) => monthEnd(ordYear(o), ordQ(o) * 3);

interface Period {
  label: string;
  start: string;
  end: string;
}
function periodFor(freq: Frequency, cy: number, q: number): Period {
  switch (freq) {
    case "Quarterly":
      return {
        label: `${cy}-Q${q}`,
        start: quarterStart(ordinal(cy, q)),
        end: quarterEnd(ordinal(cy, q)),
      };
    case "Annual":
      return { label: `${cy}`, start: `${cy}-01-01`, end: `${cy}-12-31` };
    case "6 months":
      return q <= 2
        ? { label: `${cy}-H1`, start: `${cy}-01-01`, end: `${cy}-06-30` }
        : { label: `${cy}-H2`, start: `${cy}-07-01`, end: `${cy}-12-31` };
    default:
      throw new Error("Monthly periods are derived from a month, not a quarter");
  }
}
function monthPeriod(y: number, m: number): Period {
  return { label: `${y}-${pad(m)}`, start: `${y}-${pad(m)}-01`, end: monthEnd(y, m) };
}

// ---------- normalised internal row ----------
interface Row {
  src: RawRow;
  cardKey: string;
  person: string;
  card: string;
  typeKey: string;
  benefitType: string;
  provider: string | null; // nullable in schema; NULL on some live rows
  exactBenefit: string;
  status: OrderStatus;
  cy: number;
  q: number;
  ord: number;
  frequency: Frequency; // resolved (rule 7)
  benefitKey: string;
}

export const stripCardSuffix = (card: string) => card.replace(/\s*\(\d+\)\s*$/, "").trim(); // rule 8

const hasTrackingData = (r: Row) =>
  r.status !== "Not Ordered" ||
  r.src.soldFor !== null ||
  r.src.cashValue !== null ||
  r.src.orderDate !== null ||
  r.src.expiryDate !== null ||
  r.src.bookingId !== null ||
  r.src.code !== null ||
  r.src.comments !== null;

function mode(counts: number[], warn: (m: string) => void, what: string): number {
  const freq = new Map<number, number>();
  for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
  let best = 0;
  let bestN = -1;
  const tied: number[] = [];
  for (const [v, n] of [...freq.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > bestN) {
      best = v;
      bestN = n;
      tied.length = 0;
      tied.push(v);
    } else if (n === bestN) tied.push(v);
  }
  if (tied.length > 1) warn(`instance_count tie for ${what}: counts ${tied.join("/")} equally common; using ${best}`);
  return best;
}

export function transform(raw: RawRow[]): TransformResult {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);

  // ---- normalise rows: rules 5, 5a, 6, 8 ----
  const pre: Omit<Row, "frequency" | "benefitKey">[] = [];
  for (const r of [...raw].sort((a, b) => a.rowNumber - b.rowNumber)) {
    const qm = r.quarter ? /^Q([1-4])$/i.exec(r.quarter) : null;
    if (r.cy === null || !qm || !r.card || !r.benefitType) {
      warn(`row ${r.rowNumber}: missing CY/Quarter/Card/Benefit Type; row not imported`);
      continue;
    }
    if (!r.person) warn(`row ${r.rowNumber}: Person is empty; card key uses empty person`);
    let status: OrderStatus;
    if (r.orderStatus === null) status = "Not Ordered"; // rule 5
    else if (r.orderStatus === "Sold") {
      status = "Coupon Redeemed"; // rule 5a
      if (r.soldFor === null) warn(`row ${r.rowNumber}: Sold row has no 'Sold for' amount`);
    } else if (r.orderStatus in STATUS_RANK) status = r.orderStatus as OrderStatus;
    else throw new Error(`row ${r.rowNumber}: unknown Order Status "${r.orderStatus}"`);
    const person = r.person ?? "";
    const q = Number(qm[1]);
    pre.push({
      src: r,
      person,
      card: r.card,
      cardKey: `${person}|${r.card}`,
      typeKey: stripCardSuffix(r.card),
      benefitType: r.benefitType,
      provider: r.provider,
      exactBenefit: r.exactBenefit ?? r.benefitType, // rule 6
      status,
      cy: r.cy,
      q,
      ord: ordinal(r.cy, q),
    });
  }

  // ---- rule 7: resolve NULL frequency from sibling rows of the same combination ----
  const comboKey = (r: { typeKey: string; benefitType: string; provider: string | null; exactBenefit: string }) =>
    JSON.stringify([r.typeKey, r.benefitType, r.provider, r.exactBenefit]);
  const explicitFreq = new Map<(typeof pre)[number], Frequency | null>();
  for (const r of pre) {
    const f = r.src.frequency;
    if (f !== null && !FREQUENCIES.includes(f as Frequency))
      throw new Error(`row ${r.src.rowNumber}: unknown Frequency "${f}"`);
    explicitFreq.set(r, f as Frequency | null);
  }
  const comboFreqs = new Map<string, Set<Frequency>>();
  for (const r of pre) {
    const f = explicitFreq.get(r);
    if (f) {
      const k = comboKey(r);
      if (!comboFreqs.has(k)) comboFreqs.set(k, new Set());
      comboFreqs.get(k)!.add(f);
    }
  }

  const rows: Row[] = pre.map((r) => {
    let f = explicitFreq.get(r) ?? null;
    if (!f) {
      const set = comboFreqs.get(comboKey(r));
      if (!set || set.size === 0) f = "Quarterly";
      else if (set.size === 1) f = [...set][0];
      else {
        // Genuine fork + a blank cell: ambiguous. Prefer the same quarter, else nearest earlier, else first.
        const sameCombo = pre.filter((o) => comboKey(o) === comboKey(r) && explicitFreq.get(o));
        const sameQ = sameCombo.find((o) => o.ord === r.ord);
        const earlier = sameCombo.filter((o) => o.ord <= r.ord).sort((a, b) => b.ord - a.ord)[0];
        f = explicitFreq.get(sameQ ?? earlier ?? sameCombo[0])!;
        warn(`row ${r.src.rowNumber}: blank Frequency in a forked combination; assigned ${f}`);
      }
    }
    return {
      ...r,
      frequency: f,
      benefitKey: JSON.stringify([r.typeKey, r.benefitType, r.provider, r.exactBenefit, f]), // rule 9
    };
  });

  // ---- bank card types (rule 8) ----
  const typeKeys = [...new Set(rows.map((r) => r.typeKey))].sort();
  const bankCardTypes: BankCardTypeOut[] = typeKeys.map((key) => {
    const i = key.indexOf(" ");
    return {
      key,
      bankName: i < 0 ? key : key.slice(0, i), // heuristic: first token
      cardType: i < 0 ? "" : key.slice(i + 1),
      curationStatus: "curated", // every type here has >=1 benefit row
    };
  });

  // ---- benefits + versions (rules 4, 9, 10) ----
  interface Ident {
    key: string;
    rows: Row[];
  }
  const idents = new Map<string, Ident>();
  for (const r of rows) {
    if (!idents.has(r.benefitKey)) idents.set(r.benefitKey, { key: r.benefitKey, rows: [] });
    idents.get(r.benefitKey)!.rows.push(r);
  }
  const benefits: BenefitOut[] = [];
  const versions: VersionOut[] = [];
  const identInfo = new Map<string, { first: number; last: number; row: Row; count: number }>();
  for (const id of idents.values()) {
    const r0 = id.rows[0];
    const ords = id.rows.map((r) => r.ord);
    const first = Math.min(...ords);
    const last = Math.max(...ords);
    // rule 10: most common row count per (physical card, quarter), not the max.
    const perCardQuarter = new Map<string, number>();
    for (const r of id.rows) {
      const k = `${r.cardKey}|${r.ord}`;
      perCardQuarter.set(k, (perCardQuarter.get(k) ?? 0) + 1);
    }
    const count = mode([...perCardQuarter.values()], warn, `${r0.typeKey} / ${r0.provider} / ${r0.exactBenefit}`);
    identInfo.set(id.key, { first, last, row: r0, count });
  }
  // Fork groups: same combination, >1 explicit identities. Superseded = ends before the group's latest.
  const byCombo = new Map<string, string[]>();
  for (const [k, info] of identInfo) {
    const ck = comboKey(info.row);
    if (!byCombo.has(ck)) byCombo.set(ck, []);
    byCombo.get(ck)!.push(k);
  }
  const effectiveTo = new Map<string, string>();
  for (const keys of byCombo.values()) {
    if (keys.length < 2) continue;
    const maxLast = Math.max(...keys.map((k) => identInfo.get(k)!.last));
    for (const k of keys) {
      const me = identInfo.get(k)!;
      if (me.last < maxLast) {
        effectiveTo.set(k, quarterEnd(me.last)); // rule 4
        for (const o of keys)
          if (o !== k && identInfo.get(o)!.first <= me.last)
            warn(`forked identities of ${me.row.provider} / ${me.row.exactBenefit} overlap in time`);
      }
    }
  }
  for (const [key, info] of identInfo) {
    const r = info.row;
    benefits.push({
      key,
      bankCardTypeKey: r.typeKey,
      benefitType: r.benefitType,
      benefitProvider: r.provider,
      exactBenefit: r.exactBenefit,
      frequency: r.frequency,
    });
    versions.push({
      benefitKey: key,
      benefitType: r.benefitType,
      benefitProvider: r.provider,
      exactBenefit: r.exactBenefit,
      frequency: r.frequency,
      instanceCount: info.count,
      effectiveFrom: quarterStart(info.first), // rule 4: first quarter it appears in
      effectiveTo: effectiveTo.get(key) ?? null,
    });
  }

  // ---- physical cards (rule 13) ----
  const cardMap = new Map<string, PhysicalCardOut>();
  const cardFirstOrd = new Map<string, number>();
  for (const r of rows) {
    const cur = cardFirstOrd.get(r.cardKey);
    if (cur === undefined || r.ord < cur) cardFirstOrd.set(r.cardKey, r.ord);
    if (!cardMap.has(r.cardKey))
      cardMap.set(r.cardKey, {
        key: r.cardKey,
        person: r.person,
        displayName: r.card,
        bankCardTypeKey: r.typeKey,
        trackingFrom: "",
      });
  }
  for (const [k, c] of cardMap) c.trackingFrom = quarterStart(cardFirstOrd.get(k)!);
  const physicalCards = [...cardMap.values()];

  // ---- instances (rules 10, 11 + Entitlement periods) ----
  const skippedMonthly: SkippedMonthlyRow[] = [];
  const discarded: DiscardedRow[] = [];
  interface Cand {
    row: Row;
    period: Period;
  }
  const groups = new Map<string, Cand[]>();
  for (const r of rows) {
    let period: Period;
    if (r.frequency === "Monthly") {
      const data = hasTrackingData(r);
      if (!data) {
        skippedMonthly.push({ rowNumber: r.src.rowNumber, hadTrackingData: false });
        continue; // generation creates true per-month instances
      }
      if (r.src.orderDate) {
        period = monthPeriod(Number(r.src.orderDate.slice(0, 4)), Number(r.src.orderDate.slice(5, 7)));
      } else {
        period = monthPeriod(r.cy, (r.q - 1) * 3 + 1);
        warn(`row ${r.src.rowNumber}: Monthly row has tracking data but no Order Date; mapped to first month of quarter`);
      }
    } else period = periodFor(r.frequency, r.cy, r.q);
    const gk = `${r.cardKey}\u0000${r.benefitKey}\u0000${period.label}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk)!.push({ row: r, period });
  }

  const instances: InstanceOut[] = [];
  for (const cands of groups.values()) {
    const count = identInfo.get(cands[0].row.benefitKey)!.count;
    // Most advanced status first; ties keep earliest quarter, then earliest row.
    const ranked = [...cands].sort(
      (a, b) =>
        STATUS_RANK[b.row.status] - STATUS_RANK[a.row.status] ||
        a.row.ord - b.row.ord ||
        a.row.src.rowNumber - b.row.src.rowNumber,
    );
    const keep = ranked.slice(0, count);
    for (const d of ranked.slice(count)) {
      const crossQuarter = !cands.some((c) => c !== d && c.row.ord === d.row.ord);
      discarded.push({
        rowNumber: d.row.src.rowNumber,
        reason: crossQuarter ? "cross-quarter-merge" : "same-period-duplicate",
        lossless: !hasTrackingData(d.row),
      });
    }
    keep.sort((a, b) => a.row.ord - b.row.ord || a.row.src.rowNumber - b.row.src.rowNumber);
    keep.forEach((c, i) => {
      const r = c.row;
      instances.push({
        cardKey: r.cardKey,
        benefitKey: r.benefitKey,
        periodLabel: c.period.label,
        periodStart: c.period.start,
        periodEnd: c.period.end,
        instanceNumber: i + 1,
        orderStatus: r.status,
        soldFor: r.src.soldFor,
        cashValue: r.src.cashValue,
        orderDate: r.src.orderDate,
        expiryDate: r.src.expiryDate,
        rupayBookingId: r.src.bookingId,
        code: r.src.code,
        comments: r.src.comments,
        sourceRowNumber: r.src.rowNumber,
      });
    });
  }
  instances.sort((a, b) => a.sourceRowNumber - b.sourceRowNumber);

  return { bankCardTypes, benefits, versions, physicalCards, instances, discarded, skippedMonthly, warnings };
}
