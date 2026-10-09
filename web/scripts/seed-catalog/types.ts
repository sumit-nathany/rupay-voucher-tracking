// Plain types for the catalog-seed transform. No dependency on the Drizzle schema.
import { inspect } from "node:util";

/** Wraps a sensitive value (gift-card code, booking ID) so it cannot leak via logging/JSON. */
export class Secret {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** Only the DB write layer (encrypt-before-insert) should call this. */
  reveal(): string {
    return this.#value;
  }
  toString(): string {
    return "[redacted]";
  }
  toJSON(): string {
    return "[redacted]";
  }
  [inspect.custom](): string {
    return "[redacted]";
  }
}

export type Frequency = "Annual" | "Quarterly" | "6 months" | "Monthly";
export type OrderStatus =
  | "Not Ordered"
  | "Ordered but Coupon not received"
  | "Coupon Received"
  | "Coupon Redeemed";

/** One sheet row after rules 1-4 (row filter, trim, ''->NULL, CY float->int). */
export interface RawRow {
  rowNumber: number;
  cy: number | null;
  quarter: string | null; // 'Q1'..'Q4' as written
  person: string | null;
  card: string | null;
  benefitType: string | null;
  provider: string | null;
  exactBenefit: string | null;
  frequency: string | null;
  orderStatus: string | null; // raw, may be 'Sold' or null
  soldFor: number | null;
  cashValue: number | null;
  orderDate: string | null; // YYYY-MM-DD
  expiryDate: string | null; // YYYY-MM-DD
  bookingId: Secret | null;
  code: Secret | null;
  comments: string | null;
}

export interface BankCardTypeOut {
  key: string; // card name with trailing "(digits)" stripped
  bankName: string; // heuristic: first whitespace token of key
  cardType: string; // remainder of key
  curationStatus: "curated" | "no_benefits";
}

export interface BenefitOut {
  key: string; // stable identity key (JSON of typeKey/benefitType/provider/exactBenefit/frequency)
  bankCardTypeKey: string;
  benefitType: string;
  benefitProvider: string | null;
  exactBenefit: string;
  frequency: Frequency;
}

export interface VersionOut {
  benefitKey: string;
  benefitType: string;
  benefitProvider: string | null;
  exactBenefit: string;
  frequency: Frequency;
  instanceCount: number;
  effectiveFrom: string; // YYYY-MM-DD, start of first quarter the identity appears in
  effectiveTo: string | null; // end of last quarter, only for fork-superseded identities
}

export interface PhysicalCardOut {
  key: string; // `${person}|${card name as written}`
  person: string;
  displayName: string;
  bankCardTypeKey: string;
  trackingFrom: string; // start of the earliest quarter this card has rows in
}

export interface InstanceOut {
  cardKey: string;
  benefitKey: string;
  periodLabel: string; // 2026-Q3 | 2026 | 2026-H1 | 2026-07
  periodStart: string;
  periodEnd: string; // == order_deadline
  instanceNumber: number;
  orderStatus: OrderStatus;
  soldFor: number | null;
  cashValue: number | null;
  orderDate: string | null;
  expiryDate: string | null;
  rupayBookingId: Secret | null;
  code: Secret | null;
  comments: string | null;
  sourceRowNumber: number;
}

export interface DiscardedRow {
  rowNumber: number;
  reason: "cross-quarter-merge" | "same-period-duplicate";
  lossless: boolean; // Not Ordered and no tracking fields
}

export interface SkippedMonthlyRow {
  rowNumber: number;
  hadTrackingData: boolean;
}

export interface TransformResult {
  bankCardTypes: BankCardTypeOut[];
  benefits: BenefitOut[];
  versions: VersionOut[];
  physicalCards: PhysicalCardOut[];
  instances: InstanceOut[];
  discarded: DiscardedRow[];
  skippedMonthly: SkippedMonthlyRow[];
  warnings: string[];
}
