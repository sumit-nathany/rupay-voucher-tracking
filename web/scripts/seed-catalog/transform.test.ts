import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { transform } from "./transform";
import { RawRow, Secret } from "./types";

// Synthetic fixtures only. No data from the real workbook.
let n = 1;
function row(o: Partial<RawRow> & { quarter: string; card: string; provider: string }): RawRow {
  return {
    rowNumber: n++,
    cy: 2026,
    person: "Tester",
    benefitType: "Entertainment",
    exactBenefit: "Thing",
    frequency: "Quarterly",
    orderStatus: "Not Ordered",
    soldFor: null,
    cashValue: null,
    orderDate: null,
    expiryDate: null,
    bookingId: null,
    code: null,
    comments: null,
    ...o,
  };
}
const CC = "ACME Test Credit Card";
const DC = "ACME Test Debit Card";

describe("rule 7: NULL frequency", () => {
  it("takes frequency from sibling rows and does not fork a fake identity", () => {
    const res = transform([
      row({ quarter: "Q2", card: DC, provider: "P1", frequency: "Annual", orderStatus: "Coupon Received" }),
      row({ quarter: "Q3", card: DC, provider: "P1", frequency: null }),
      row({ quarter: "Q4", card: DC, provider: "P1", frequency: null }),
    ]);
    expect(res.benefits).toHaveLength(1);
    expect(res.benefits[0].frequency).toBe("Annual");
    expect(res.instances).toHaveLength(1);
    expect(res.instances[0].periodLabel).toBe("2026");
  });
  it("defaults to Quarterly only if no row has a frequency", () => {
    const res = transform([row({ quarter: "Q1", card: DC, provider: "P2", frequency: null })]);
    expect(res.benefits[0].frequency).toBe("Quarterly");
  });
});

describe("BookMyShow-style fork (explicit Quarterly then Monthly)", () => {
  const rows = [
    row({ quarter: "Q1", card: CC, provider: "BMS", frequency: "Quarterly" }),
    row({ quarter: "Q2", card: CC, provider: "BMS", frequency: "Monthly" }),
    row({ quarter: "Q3", card: CC, provider: "BMS", frequency: "Monthly" }),
    row({ quarter: "Q4", card: CC, provider: "BMS", frequency: "Monthly" }),
  ];
  const res = transform(rows);
  it("forks into two identities with correct effective dates", () => {
    expect(res.benefits.map((b) => b.frequency).sort()).toEqual(["Monthly", "Quarterly"]);
    const q = res.versions.find((v) => v.frequency === "Quarterly")!;
    const m = res.versions.find((v) => v.frequency === "Monthly")!;
    expect(q.effectiveFrom).toBe("2026-01-01");
    expect(q.effectiveTo).toBe("2026-03-31");
    expect(m.effectiveFrom).toBe("2026-04-01");
    expect(m.effectiveTo).toBeNull();
  });
  it("skips quarter-grained Monthly rows; Monthly instance_count is 1 not 3", () => {
    expect(res.skippedMonthly).toHaveLength(3);
    expect(res.instances.filter((i) => i.periodLabel.length === 7 && !i.periodLabel.includes("Q"))).toHaveLength(0);
    expect(res.versions.find((v) => v.frequency === "Monthly")!.instanceCount).toBe(1);
    expect(res.instances).toHaveLength(1); // only the Q1 Quarterly row
  });
  it("maps a Monthly row with real tracking data to the month of its order date", () => {
    const r = transform([
      row({
        quarter: "Q3",
        card: CC,
        provider: "BMS",
        frequency: "Monthly",
        orderStatus: "Coupon Received",
        orderDate: "2026-08-14",
      }),
    ]);
    expect(r.skippedMonthly).toHaveLength(0);
    expect(r.instances).toHaveLength(1);
    expect(r.instances[0].periodLabel).toBe("2026-08");
    expect(r.instances[0].periodStart).toBe("2026-08-01");
    expect(r.instances[0].periodEnd).toBe("2026-08-31");
  });
});

describe("rule 10: instance_count is the most common per (card, quarter), not the max", () => {
  it("3 per quarter every quarter => 3", () => {
    const rows: RawRow[] = [];
    for (const q of ["Q1", "Q2", "Q3"]) for (let i = 0; i < 3; i++) rows.push(row({ quarter: q, card: CC, provider: "BB" }));
    const res = transform(rows);
    expect(res.versions[0].instanceCount).toBe(3);
    expect(res.instances).toHaveLength(9);
    expect(res.instances.filter((i) => i.periodLabel === "2026-Q2").map((i) => i.instanceNumber)).toEqual([1, 2, 3]);
  });
  it("doubled rows in one quarter among singles => 1, keeping the most advanced", () => {
    const res = transform([
      row({ quarter: "Q2", card: DC, provider: "AP" }),
      row({ quarter: "Q3", card: DC, provider: "AP", orderStatus: "Not Ordered" }),
      row({ quarter: "Q3", card: DC, provider: "AP", orderStatus: "Coupon Redeemed" }),
      row({ quarter: "Q4", card: DC, provider: "AP" }),
    ]);
    expect(res.versions[0].instanceCount).toBe(1);
    expect(res.instances).toHaveLength(3);
    const q3 = res.instances.find((i) => i.periodLabel === "2026-Q3")!;
    expect(q3.orderStatus).toBe("Coupon Redeemed");
    expect(res.discarded).toEqual([
      expect.objectContaining({ reason: "same-period-duplicate", lossless: true }),
    ]);
  });
  it("mode considers every physical card sharing the type", () => {
    const res = transform([
      row({ quarter: "Q2", card: `${DC} (1111)`, provider: "AP", person: "A" }),
      row({ quarter: "Q2", card: `${DC} (2222)`, provider: "AP", person: "B" }),
      row({ quarter: "Q2", card: `${DC} (2222)`, provider: "AP", person: "B" }),
      row({ quarter: "Q3", card: `${DC} (1111)`, provider: "AP", person: "A" }),
      row({ quarter: "Q3", card: `${DC} (2222)`, provider: "AP", person: "B" }),
    ]);
    expect(res.versions[0].instanceCount).toBe(1);
    expect(res.instances).toHaveLength(4);
  });
});

describe("rule 11: Annual / 6-month merges across quarters", () => {
  it("Annual keeps the most advanced status; discards are lossless", () => {
    const res = transform([
      row({ quarter: "Q2", card: CC, provider: "G", frequency: "Annual", orderStatus: "Coupon Redeemed", orderDate: "2026-05-02", comments: "x" }),
      row({ quarter: "Q3", card: CC, provider: "G", frequency: "Annual" }),
      row({ quarter: "Q4", card: CC, provider: "G", frequency: "Annual" }),
    ]);
    expect(res.instances).toHaveLength(1);
    expect(res.instances[0].orderStatus).toBe("Coupon Redeemed");
    expect(res.instances[0].periodLabel).toBe("2026");
    expect(res.discarded.map((d) => d.reason)).toEqual(["cross-quarter-merge", "cross-quarter-merge"]);
    expect(res.discarded.every((d) => d.lossless)).toBe(true);
  });
  it("tie keeps the earliest quarter; most advanced wins even when later", () => {
    const q4 = row({ quarter: "Q4", card: CC, provider: "G", frequency: "Annual" });
    const q2 = row({ quarter: "Q2", card: CC, provider: "G", frequency: "Annual" });
    const tie = transform([q4, q2]);
    expect(tie.instances[0].sourceRowNumber).toBe(q2.rowNumber);
    const later = transform([
      row({ quarter: "Q2", card: CC, provider: "G", frequency: "Annual" }),
      row({ quarter: "Q3", card: CC, provider: "G", frequency: "Annual", orderStatus: "Coupon Received" }),
    ]);
    expect(later.instances[0].orderStatus).toBe("Coupon Received");
  });
  it("6 months splits into H1 (Q1+Q2) and H2 (Q3+Q4)", () => {
    const res = transform(
      ["Q1", "Q2", "Q3", "Q4"].map((q) => row({ quarter: q, card: CC, provider: "H", frequency: "6 months" })),
    );
    expect(res.instances.map((i) => i.periodLabel).sort()).toEqual(["2026-H1", "2026-H2"]);
    const h2 = res.instances.find((i) => i.periodLabel === "2026-H2")!;
    expect(h2.periodStart).toBe("2026-07-01");
    expect(h2.periodEnd).toBe("2026-12-31");
  });
  it("flags a lossy discard", () => {
    const res = transform([
      row({ quarter: "Q2", card: CC, provider: "G", frequency: "Annual", orderStatus: "Coupon Redeemed" }),
      row({ quarter: "Q3", card: CC, provider: "G", frequency: "Annual", orderStatus: "Not Ordered", orderDate: "2026-08-01" }),
    ]);
    expect(res.discarded[0].lossless).toBe(false);
  });
});

describe("rule 8: card type key", () => {
  it("three numbered physical cards => one bank_card_type, three cards, shared benefits, per-card instances", () => {
    const rows = ["(7825)", "(1746)", "(5110)"].flatMap((s) => [
      row({ quarter: "Q2", card: `PNB Test Imperial DC ${s}`, provider: "Q" }),
      row({ quarter: "Q3", card: `PNB Test Imperial DC ${s}`, provider: "Q" }),
    ]);
    const res = transform(rows);
    expect(res.bankCardTypes).toHaveLength(1);
    expect(res.bankCardTypes[0]).toMatchObject({ key: "PNB Test Imperial DC", bankName: "PNB", curationStatus: "curated" });
    expect(res.physicalCards).toHaveLength(3);
    expect(res.benefits).toHaveLength(1);
    expect(res.instances).toHaveLength(6);
  });
  it("unnumbered and numbered names fall into the same type", () => {
    const res = transform([
      row({ quarter: "Q1", card: DC, provider: "Q" }),
      row({ quarter: "Q2", card: `${DC} (5159)`, provider: "Q" }),
    ]);
    expect(res.bankCardTypes).toHaveLength(1);
    expect(res.physicalCards).toHaveLength(2);
  });
});

describe("rule 4 / 13: effective_from and tracking_from from observed quarters", () => {
  it("benefit first seen in Q2 starts in Q2, not CY Jan 1; tracking_from is the card's first quarter", () => {
    const res = transform([
      row({ quarter: "Q4", card: CC, provider: "L" }),
      row({ quarter: "Q2", card: CC, provider: "L" }),
      row({ quarter: "Q3", card: CC, provider: "L" }),
    ]);
    expect(res.versions[0].effectiveFrom).toBe("2026-04-01");
    expect(res.versions[0].effectiveTo).toBeNull();
    expect(res.physicalCards[0].trackingFrom).toBe("2026-04-01");
  });
});

describe("statuses and field fixes", () => {
  it("Sold -> Coupon Redeemed with sold_for; NULL status -> Not Ordered; NULL Exact Benefit -> Benefit Type", () => {
    const res = transform([
      row({ quarter: "Q1", card: CC, provider: "S", orderStatus: "Sold", soldFor: 450 }),
      row({ quarter: "Q1", card: CC, provider: "Golf", benefitType: "Golf Program", exactBenefit: null, frequency: null, orderStatus: null }),
    ]);
    const sold = res.instances.find((i) => i.soldFor === 450)!;
    expect(sold.orderStatus).toBe("Coupon Redeemed");
    const golf = res.benefits.find((b) => b.benefitProvider === "Golf")!;
    expect(golf.exactBenefit).toBe("Golf Program");
    expect(res.instances.find((i) => i.benefitKey === golf.key)!.orderStatus).toBe("Not Ordered");
  });
  it("unknown status throws without echoing cell data", () => {
    expect(() => transform([row({ quarter: "Q1", card: CC, provider: "S", orderStatus: "Weird" })])).toThrow(/unknown Order Status/);
  });
  it("trimmed provider ('Cult.fit ') is the same identity as 'Cult.fit' (reader trims; transform is exact)", () => {
    // Reader applies rule 2. Simulate post-reader rows: both already trimmed.
    const res = transform([
      row({ quarter: "Q1", card: CC, provider: "Cult.fit" }),
      row({ quarter: "Q2", card: CC, provider: "Cult.fit" }),
    ]);
    expect(res.benefits).toHaveLength(1);
    expect(res.benefits[0].benefitProvider).toBe("Cult.fit");
  });
});

describe("secrets never leak", () => {
  it("codes and booking IDs are redacted in JSON, string and inspect output", () => {
    const res = transform([
      row({ quarter: "Q1", card: CC, provider: "S", code: new Secret("SYNTHETIC-CODE-123"), bookingId: new Secret("SYNTH-BK-9") }),
    ]);
    const i = res.instances[0];
    expect(JSON.stringify(i)).not.toContain("SYNTHETIC");
    expect(`${i.code}`).toBe("[redacted]");
    expect(inspect(i)).not.toContain("SYNTH");
    expect(i.code!.reveal()).toBe("SYNTHETIC-CODE-123");
  });
});
