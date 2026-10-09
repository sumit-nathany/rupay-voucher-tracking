// Run: npx tsx scripts/seed-catalog/inspect.ts [path-to-xlsx]
// Prints ONLY aggregate, non-sensitive counts. Never prints Code / Booking ID values.
import { readRawRows } from "./reader";
import { transform } from "./transform";

async function main() {
  const raw = await readRawRows(process.argv[2]);
  const res = transform(raw);
  const tally = <T>(xs: T[], f: (x: T) => string) => {
    const m: Record<string, number> = {};
    for (const x of xs) m[f(x)] = (m[f(x)] ?? 0) + 1;
    return Object.fromEntries(Object.entries(m).sort());
  };

  console.log("source rows (rule 1):", raw.length);
  console.log("physical cards:", res.physicalCards.length);
  console.log("bank_card_types:", res.bankCardTypes.length);
  console.log("benefits (identities):", res.benefits.length, "| versions:", res.versions.length);
  console.log("instances:", res.instances.length);
  console.log("skipped Monthly rows:", res.skippedMonthly.length, "| with tracking data:", res.skippedMonthly.filter((s) => s.hadTrackingData).length);
  console.log("discarded duplicate rows:", res.discarded.length, tally(res.discarded, (d) => d.reason));
  const lossy = res.discarded.filter((d) => !d.lossless).length;
  console.log(`rule 11 lossless check: ${lossy === 0 ? "PASS" : "FAIL"} (${res.discarded.length - lossy}/${res.discarded.length} lossless, ${lossy} lossy)`);
  console.log("accounting: rows - skipped Monthly - discarded =", raw.length - res.skippedMonthly.length - res.discarded.length, "(instances:", res.instances.length + ")");
  console.log("status counts:", tally(res.instances, (i) => i.orderStatus));
  console.log("instances with sold_for:", res.instances.filter((i) => i.soldFor !== null).length);
  console.log("benefits by frequency:", tally(res.benefits, (b) => b.frequency));
  console.log("versions with effective_to:", res.versions.filter((v) => v.effectiveTo).length);
  console.log("instance_count distribution:", tally(res.versions, (v) => String(v.instanceCount)));
  console.log("benefits per card type:", tally(res.benefits, (b) => b.bankCardTypeKey));
  console.log("physical cards per type:", tally(res.physicalCards, (c) => c.bankCardTypeKey));
  console.log("cards (person | name | type | tracking_from):");
  for (const c of res.physicalCards) console.log("  ", c.person, "|", c.displayName, "|", c.bankCardTypeKey, "|", c.trackingFrom);
  console.log("warnings:", res.warnings.length);
  for (const w of res.warnings) console.log("  ", w);
}
main().catch((e) => {
  console.error("inspect failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
