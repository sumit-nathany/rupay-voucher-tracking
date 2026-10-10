/**
 * Imports "Rupay Select" sheet from Gift Voucher Tracker.xlsx into the DB.
 *
 * Usage (from web/):
 *   npx tsx scripts/excel-import/rupay-select.ts          # dry-run
 *   npx tsx scripts/excel-import/rupay-select.ts --write  # writes to DB
 *
 * Reads DATABASE_URL and VOUCHER_ENCRYPTION_KEY from environment (load .env.local first).
 */

import { createCipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WRITE = process.argv.includes("--write");

// ── Encryption (mirrors src/lib/crypto.ts) ───────────────────────────────────
const IV_LEN = 12;
const TAG_LEN = 16;
function getKey(): Buffer {
  const raw = process.env.VOUCHER_ENCRYPTION_KEY;
  if (!raw) throw new Error("VOUCHER_ENCRYPTION_KEY not set");
  const b64 = raw.startsWith("base64:") ? raw.slice(7) : raw;
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("VOUCHER_ENCRYPTION_KEY must be 32 bytes");
  return key;
}
function encryptCode(plaintext: string, rowId: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN } as Parameters<typeof createCipheriv>[3]);
  (cipher as ReturnType<typeof createCipheriv> & { setAAD(b: Buffer): void }).setAAD(Buffer.from(rowId, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = (cipher as ReturnType<typeof createCipheriv> & { getAuthTag(): Buffer }).getAuthTag();
  return `v1.${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

// ── DB constants ──────────────────────────────────────────────────────────────
const WORKSPACE_ID = "c55818d7-7fcd-49a6-a270-cb908a9a0840";

// Existing holders
const HOLDERS: Record<string, string> = {
  Sumit: "680540cc-4206-47f4-b3e5-d1183ca3bfc2",
  Neha: "3a56a4a1-235d-4826-a7d1-f8fd8b38367a",
};

// Bank card type IDs
const BCT = {
  BOI_DEBIT: "6ea891d3-25e3-4b77-974f-485423443ace",
  PNB_IMPERIAL: "a208d02d-e2a0-4bc6-8cde-53e411872a9d",
  BOI_CREDIT: "9420485d-4317-4719-9331-d55b11dbdadc",
  PNB_CREDIT: "95c35581-73a9-47da-9548-0c73782d1354",
};

// Existing cards: [cardId, lastDigits-to-set, trackingFrom-to-set]
const EXISTING_CARDS: Record<string, { cardId: string; newLastDigits: string; newTrackingFrom: string }> = {
  BOI_5159: { cardId: "8797345f-4ede-46e8-bf34-b1531ed2797a", newLastDigits: "5159", newTrackingFrom: "2026-01-01" },
  PNB_7825: { cardId: "8ca54ab9-d807-4f5a-a3c0-599ad782e513", newLastDigits: "7825", newTrackingFrom: "2026-04-01" },
};

// Benefit catalog: benefitId, versionId, frequency, pickOne
interface BenefitEntry {
  id: string;
  versionId: string;
  frequency: string;
  pickOne: boolean;
}
type BenefitMap = Map<string, BenefitEntry>; // key = "type|provider" (lowercased)

// BOI Debit benefits (bank_card_type_id = BOI_DEBIT)
const BOI_DEBIT_BENEFITS: BenefitMap = new Map([
  ["spa services|", { id: "f08ab4f1-0178-42fb-a3e3-dca1fc4d5978", versionId: "ca1c1e9b-d379-4748-bd37-271ddfa5cedc", frequency: "Quarterly", pickOne: true }],
  ["ott entertainment|", { id: "f7970dcd-9353-4848-916d-3f662cd78557", versionId: "50d6720d-2a50-4f25-8df3-6d88cfe0ba1f", frequency: "Annual", pickOne: true }],
  ["health check up|", { id: "771a2162-7ea8-4f8e-9d55-f6484ba9831e", versionId: "c1df8ac3-2b81-4b0f-bb5f-2749e92b2d35", frequency: "Quarterly", pickOne: true }],
  ["health check up|thyrocare", { id: "771a2162-7ea8-4f8e-9d55-f6484ba9831e", versionId: "c1df8ac3-2b81-4b0f-bb5f-2749e92b2d35", frequency: "Quarterly", pickOne: true }],
  ["health checkup|thyrocare", { id: "771a2162-7ea8-4f8e-9d55-f6484ba9831e", versionId: "c1df8ac3-2b81-4b0f-bb5f-2749e92b2d35", frequency: "Quarterly", pickOne: true }],
  ["health check up|srl", { id: "771a2162-7ea8-4f8e-9d55-f6484ba9831e", versionId: "c1df8ac3-2b81-4b0f-bb5f-2749e92b2d35", frequency: "Quarterly", pickOne: true }],
  ["health checkup|srl", { id: "771a2162-7ea8-4f8e-9d55-f6484ba9831e", versionId: "c1df8ac3-2b81-4b0f-bb5f-2749e92b2d35", frequency: "Quarterly", pickOne: true }],
  ["gym access|", { id: "6c7012a4-ad5e-4f1a-b78f-f812976c9222", versionId: "c9c57819-7de1-4097-bd8b-043672725ca4", frequency: "Quarterly", pickOne: true }],
  ["cab services|", { id: "54a0d991-3147-40b4-8bc7-15cac91e9089", versionId: "8e7921d8-f039-4f00-b069-976973aa1fe3", frequency: "Quarterly", pickOne: true }],
  ["travel|", { id: "54a0d991-3147-40b4-8bc7-15cac91e9089", versionId: "8e7921d8-f039-4f00-b069-976973aa1fe3", frequency: "Quarterly", pickOne: true }],
]);

// PNB Imperial benefits
const PNB_IMPERIAL_BENEFITS: BenefitMap = new Map([
  ["spa services|", { id: "d95a470b-e207-440b-b9e5-2b73cb95f30e", versionId: "3b745699-f966-4238-b3e4-0a45d9afc50b", frequency: "Quarterly", pickOne: true }],
  ["ott entertainment|", { id: "09227671-ec6c-40ca-8ddf-33dcf7fc97af", versionId: "33e63c1c-9986-4ad1-bfa8-e8bdc15f9e39", frequency: "Annual", pickOne: true }],
  ["gym access|cult.fit", { id: "c3859cd3-9b71-4bbf-9b5b-ffd34bc6aed0", versionId: "9a673201-33aa-4bb9-86f2-ba523c71d331", frequency: "Quarterly", pickOne: false }],
  ["health check up|", { id: "bff5cc27-fe03-4b82-b94c-c92a855f7584", versionId: "c3fef6ac-dd71-4ad5-bc26-4eb89d4d0e10", frequency: "Annual", pickOne: true }],
  ["health check up|thyrocare", { id: "bff5cc27-fe03-4b82-b94c-c92a855f7584", versionId: "c3fef6ac-dd71-4ad5-bc26-4eb89d4d0e10", frequency: "Annual", pickOne: true }],
  ["health checkup|thyrocare", { id: "bff5cc27-fe03-4b82-b94c-c92a855f7584", versionId: "c3fef6ac-dd71-4ad5-bc26-4eb89d4d0e10", frequency: "Annual", pickOne: true }],
  ["health check up|srl", { id: "bff5cc27-fe03-4b82-b94c-c92a855f7584", versionId: "c3fef6ac-dd71-4ad5-bc26-4eb89d4d0e10", frequency: "Annual", pickOne: true }],
  ["health checkup|srl", { id: "bff5cc27-fe03-4b82-b94c-c92a855f7584", versionId: "c3fef6ac-dd71-4ad5-bc26-4eb89d4d0e10", frequency: "Annual", pickOne: true }],
  ["online groceries|big basket", { id: "853d7bed-83c9-4fb2-812a-0c1f5027b6e1", versionId: "d4f7444a-39b6-465f-b703-68bf413da992", frequency: "Quarterly", pickOne: false }],
  ["food delivery|swiggy one", { id: "6386bbc0-7733-4a0a-9ea5-f971582841d7", versionId: "2a8b8dff-c25a-465e-98ee-7cab2567adf3", frequency: "Annual", pickOne: false }],
  ["entertainment|bookmyshow", { id: "b6041a6a-c052-4bd8-bb67-c9ec85abcc0b", versionId: "dbb4a849-2735-43c7-b1c3-022a03862bd9", frequency: "Quarterly", pickOne: false }],
  ["online music|gaana", { id: "284fe668-f52c-4f34-950b-6ed052f51da4", versionId: "355d24e1-bd98-47f7-beaa-27c1dccb3b2d", frequency: "Annual", pickOne: false }],
  ["online shopping|decathlon", { id: "3c3b8418-6791-45a6-ba52-ebd72adf8256", versionId: "70d0a6a1-e20b-4fc9-b9fc-f92ee7f3d089", frequency: "Quarterly", pickOne: false }],
  ["online shopping|kalyan jewellers", { id: "e90c5102-41b9-4683-863d-ed897ca48686", versionId: "d46a33db-e9b3-47f6-991c-2e88faefb067", frequency: "6 months", pickOne: false }],
  ["online shopping|kalyan jewellery", { id: "e90c5102-41b9-4683-863d-ed897ca48686", versionId: "d46a33db-e9b3-47f6-991c-2e88faefb067", frequency: "6 months", pickOne: false }],
  ["online shopping|myntra", { id: "56da1173-18ef-4831-b69d-d54e19df99ee", versionId: "59ea4988-713c-439e-9e0c-da0004624acd", frequency: "Quarterly", pickOne: false }],
  ["online shopping|reliance digital", { id: "554240ff-9f29-46b6-8d99-8461daf5757e", versionId: "258b48fc-18e0-47ec-ae83-e389a3c83e07", frequency: "Quarterly", pickOne: false }],
  ["online pharmacy|apollo pharmacy", { id: "5437f595-84d4-466c-b062-2ef201c6b43d", versionId: "cf957894-5c73-4c44-8ac4-83c93933cacd", frequency: "Quarterly", pickOne: false }],
  ["tax compliance|taxspanner", { id: "934d3f30-8b9b-4b7f-85da-a574aab194ce", versionId: "a435a4d9-baa9-4850-a14f-c6bfa258882e", frequency: "Annual", pickOne: false }],
  ["travel|makemytrip", { id: "d4f02277-bf60-4775-a6ff-f336a0ecfcfb", versionId: "d4b41306-8f78-442b-9ea2-6417a4348011", frequency: "Annual", pickOne: false }],
]);

// BOI Credit benefits
const BOI_CREDIT_BENEFITS: BenefitMap = new Map([
  ["ott entertainment|prime video", { id: "49ce8263-195f-4fe5-bcc7-5d0f3ecbad44", versionId: "13bb45ed-6725-4224-88fd-be7b7e93980f", frequency: "Annual", pickOne: false }],
  ["ott entertainment|amazon prime", { id: "49ce8263-195f-4fe5-bcc7-5d0f3ecbad44", versionId: "13bb45ed-6725-4224-88fd-be7b7e93980f", frequency: "Annual", pickOne: false }],
  ["online groceries|big basket", { id: "25b95128-e407-4309-a220-a3b05059eaea", versionId: "05a77e73-2107-4d1b-90c7-d387d3868a80", frequency: "Monthly", pickOne: false }],
  ["health check up|", { id: "52d1821c-8fbc-4374-b091-31629f1af847", versionId: "5bd33ea5-ee3a-4356-8ba0-5c9fb480fb33", frequency: "Annual", pickOne: true }],
  ["health check up|thyrocare", { id: "52d1821c-8fbc-4374-b091-31629f1af847", versionId: "5bd33ea5-ee3a-4356-8ba0-5c9fb480fb33", frequency: "Annual", pickOne: true }],
  ["health checkup|thyrocare", { id: "52d1821c-8fbc-4374-b091-31629f1af847", versionId: "5bd33ea5-ee3a-4356-8ba0-5c9fb480fb33", frequency: "Annual", pickOne: true }],
  ["health check up|srl", { id: "52d1821c-8fbc-4374-b091-31629f1af847", versionId: "5bd33ea5-ee3a-4356-8ba0-5c9fb480fb33", frequency: "Annual", pickOne: true }],
  ["health checkup|srl", { id: "52d1821c-8fbc-4374-b091-31629f1af847", versionId: "5bd33ea5-ee3a-4356-8ba0-5c9fb480fb33", frequency: "Annual", pickOne: true }],
  ["food delivery|swiggy one", { id: "b455d225-19b1-4dac-a65c-aad391244c50", versionId: "924e7efd-0ca6-4145-98f2-2eb2706daa0d", frequency: "Annual", pickOne: false }],
  ["entertainment|bookmyshow", { id: "eebb853b-4a8e-4a97-ac41-14fd5bf3549c", versionId: "91ff1c9e-a00b-424a-b97c-3636c927b36e", frequency: "Monthly", pickOne: false }],
]);

// PNB Credit benefits
const PNB_CREDIT_BENEFITS: BenefitMap = new Map([
  ["spa services|four fountains", { id: "49d8fbec-458c-4462-a204-19f8bce8deb4", versionId: "5c3b48bc-2e11-494e-a0fc-a4d29de789e0", frequency: "Annual", pickOne: false }],
  ["health checkup|thyrocare", { id: "c8bc9913-27ce-4e61-b018-606b27026052", versionId: "26cf8770-25a7-4310-b63d-628d5d5359fd", frequency: "Annual", pickOne: false }],
  ["health check up|thyrocare", { id: "c8bc9913-27ce-4e61-b018-606b27026052", versionId: "26cf8770-25a7-4310-b63d-628d5d5359fd", frequency: "Annual", pickOne: false }],
  ["gym access|cult.fit", { id: "be36ce44-da42-4702-820b-186d35dc05f4", versionId: "435dea05-66a3-41af-a722-39334b25d7e4", frequency: "Annual", pickOne: false }],
  ["golf program|", { id: "af925892-4395-4d02-bf44-0529c9a00db7", versionId: "eb9d6d76-d0ce-4d80-a292-ba454c7d28a4", frequency: "Annual", pickOne: false }],
]);

// Pick-one option IDs: "benefitId|providerLower" → optionId
const PICK_ONE_OPTIONS: Record<string, string> = {
  // BOI Debit Health Check Up options
  "771a2162-7ea8-4f8e-9d55-f6484ba9831e|thyrocare": "30628b09-01a1-4c9f-b904-498348142165",
  "771a2162-7ea8-4f8e-9d55-f6484ba9831e|srl": "5b905088-e7f5-47f7-850b-bfd034433aaa",
  "771a2162-7ea8-4f8e-9d55-f6484ba9831e|srl diagnostics": "5b905088-e7f5-47f7-850b-bfd034433aaa",
  // PNB Imperial Health Check Up options
  "bff5cc27-fe03-4b82-b94c-c92a855f7584|thyrocare": "b4a84395-34fd-40c3-8ed6-4284639f9acd",
  "bff5cc27-fe03-4b82-b94c-c92a855f7584|srl": "fbe3255e-bf76-44a0-a811-15533c31c5ca",
  "bff5cc27-fe03-4b82-b94c-c92a855f7584|srl diagnostics": "fbe3255e-bf76-44a0-a811-15533c31c5ca",
  // BOI Credit Health Check Up options
  "52d1821c-8fbc-4374-b091-31629f1af847|thyrocare": "eaab5b7c-dd71-4d1a-842d-1dd7806add09",
  "52d1821c-8fbc-4374-b091-31629f1af847|srl": "050afe25-3511-4acc-9459-b45906e78a95",
  "52d1821c-8fbc-4374-b091-31629f1af847|srl diagnostics": "050afe25-3511-4acc-9459-b45906e78a95",
  // BOI Debit Spa options
  "f08ab4f1-0178-42fb-a3e3-dca1fc4d5978|aromthai": "a460cc02-1875-4abd-8240-3b92606fa2df",
  "f08ab4f1-0178-42fb-a3e3-dca1fc4d5978|four fountains": "6ee42229-6287-42ec-975e-21f5688ad78a",
  "f08ab4f1-0178-42fb-a3e3-dca1fc4d5978|hr wellness": "b9ef5630-8cb4-4737-8586-213169a0c233",
  "f08ab4f1-0178-42fb-a3e3-dca1fc4d5978|kairali": "28098e80-1e60-452d-a612-6f2ab1d199b0",
  "f08ab4f1-0178-42fb-a3e3-dca1fc4d5978|lakme": "dbeca0e2-bc61-492c-8d78-9902bd90a575",
  "f08ab4f1-0178-42fb-a3e3-dca1fc4d5978|ode": "ccbffb0c-73fb-4aeb-9642-cda30ab68ef6",
  // BOI Debit Gym options
  "6c7012a4-ad5e-4f1a-b78f-f812976c9222|cult.fit|3 month": "26f8e26b-6349-4f01-bd3b-af022ab5b811",
  "6c7012a4-ad5e-4f1a-b78f-f812976c9222|cult.fit|1 month": "cabdf360-7308-4bf1-bc27-8ef76d0b2de7",
  // BOI Debit OTT options
  "f7970dcd-9353-4848-916d-3f662cd78557|prime video": "df722df1-4431-4ffd-9979-84acf66a469e",
  "f7970dcd-9353-4848-916d-3f662cd78557|amazon prime": "df722df1-4431-4ffd-9979-84acf66a469e",
  "f7970dcd-9353-4848-916d-3f662cd78557|sonyliv": "023ef549-0566-4549-bf40-fa937563952c",
  "f7970dcd-9353-4848-916d-3f662cd78557|zee5": "273ca0a3-b9ca-46e9-8ffe-5bf22620373d",
  // BOI Debit Cab / Travel (Ola or Uber)
  "54a0d991-3147-40b4-8bc7-15cac91e9089|ola": "7c4e6a10-b011-4cab-8001-010000000001",
  "54a0d991-3147-40b4-8bc7-15cac91e9089|uber": "7c4e6a10-b011-4cab-8001-010000000002",
  // PNB Imperial Spa options
  "d95a470b-e207-440b-b9e5-2b73cb95f30e|four fountains": "2fdfed8e-8dad-47bf-b8bd-69286a31f9f0",
  "d95a470b-e207-440b-b9e5-2b73cb95f30e|aromthai": "c49c2f1a-08fa-401d-9e11-9e4982927cf3",
  "d95a470b-e207-440b-b9e5-2b73cb95f30e|hr wellness": "fc980a9c-36ab-4e84-b0de-492389541602",
  "d95a470b-e207-440b-b9e5-2b73cb95f30e|kairali": "2223a870-7fc8-4f5b-9993-ed397f81988f",
  "d95a470b-e207-440b-b9e5-2b73cb95f30e|lakme": "b1d3f9c8-2d1b-4e3a-a07b-a61b174217c1",
  "d95a470b-e207-440b-b9e5-2b73cb95f30e|ode": "48291190-35c6-49e4-a6a3-998d716aaa2c",
  // PNB Imperial OTT options
  "09227671-ec6c-40ca-8ddf-33dcf7fc97af|hotstar": "78beae5a-b33f-4205-aee2-0a9baa86150c",
  "09227671-ec6c-40ca-8ddf-33dcf7fc97af|prime video": "c6b39f41-c727-4098-9a51-bf88ff32f626",
  "09227671-ec6c-40ca-8ddf-33dcf7fc97af|amazon prime": "c6b39f41-c727-4098-9a51-bf88ff32f626",
};

// ── Period helpers ────────────────────────────────────────────────────────────
function daysInMonth(y: number, m: number) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function quarterPeriod(cy: number, q: number) {
  const m0 = (q - 1) * 3 + 1;
  return { start: ymd(cy, m0, 1), end: ymd(cy, m0 + 2, daysInMonth(cy, m0 + 2)), label: `${cy}-Q${q}` };
}
function annualPeriod(cy: number) {
  return { start: ymd(cy, 1, 1), end: ymd(cy, 12, 31), label: `${cy}` };
}
function halfPeriod(cy: number, h: 1 | 2) {
  return { start: ymd(cy, h === 1 ? 1 : 7, 1), end: ymd(cy, h === 1 ? 6 : 12, daysInMonth(cy, h === 1 ? 6 : 12)), label: `${cy}-H${h}` };
}
function monthPeriod(cy: number, m: number) {
  return { start: ymd(cy, m, 1), end: ymd(cy, m, daysInMonth(cy, m)), label: `${cy}-${String(m).padStart(2, "0")}` };
}

function getPeriod(cy: number, q: number, frequency: string): { start: string; end: string; label: string }[] {
  switch (frequency) {
    case "Annual": return [annualPeriod(cy)];
    case "Quarterly": return [quarterPeriod(cy, q)];
    case "6 months": {
      // Treat Q1/Q2 → H1, Q3/Q4 → H2
      const h = q <= 2 ? 1 : 2;
      return [halfPeriod(cy, h as 1 | 2)];
    }
    case "Monthly": {
      // Return all 3 months in the quarter (caller picks the right one for each instance)
      const m0 = (q - 1) * 3 + 1;
      return [monthPeriod(cy, m0), monthPeriod(cy, m0 + 1), monthPeriod(cy, m0 + 2)];
    }
    default: return [quarterPeriod(cy, q)];
  }
}

// ── Excel parsing ─────────────────────────────────────────────────────────────
interface ExcelRow {
  rowNum: number;
  cy: number;
  quarter: number; // 1-4
  person: string;
  cardName: string;
  benefitType: string;
  provider: string | null;
  exactBenefit: string | null;
  excelFrequency: string | null;
  orderStatus: string;
  soldFor: number | null;
  cashValue: number | null;
  orderDate: string | null;
  expiryDate: string | null;
  rupayBookingId: string | null;
  code: string | null;
  comments: string | null;
}

function parseStatus(s: string | null): string {
  if (!s) return "Not Ordered";
  const t = s.trim();
  if (t === "Sold") return "Coupon Redeemed"; // map Sold → Coupon Redeemed
  if (["Not Ordered", "Ordered but Coupon not received", "Coupon Received", "Coupon Redeemed", "Skipped", "Withdrawn"].includes(t)) return t;
  return "Not Ordered";
}

function cellVal(cell: ExcelJS.Cell): string | number | null {
  let v = cell.value as ExcelJS.CellValue;
  if (v == null) return null;
  if (typeof v === "object" && "result" in (v as object)) v = (v as { result: ExcelJS.CellValue }).result;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v !== null && "text" in (v as object)) return (v as { text: string }).text;
  if (typeof v === "string") { const t = v.trim(); return t === "" ? null : t; }
  if (typeof v === "number") return v;
  return null;
}

async function parseExcel(filePath: string): Promise<ExcelRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.getWorksheet("Rupay Select");
  if (!sheet) throw new Error("Sheet 'Rupay Select' not found");

  const rows: ExcelRow[] = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const c = (i: number) => cellVal(row.getCell(i));
    const person = c(3);
    const benefitType = c(5);
    if (typeof person !== "string" || !person.trim()) return;
    if (typeof benefitType !== "string" || !benefitType.trim()) return;

    const qStr = String(c(2) ?? "");
    const qNum = parseInt(qStr.replace("Q", ""), 10);
    if (isNaN(qNum) || qNum < 1 || qNum > 4) return;

    const rawStatus = c(9);
    const soldFor = typeof c(10) === "number" ? (c(10) as number) : null;
    const cashValue = typeof c(11) === "number" ? (c(11) as number) : null;

    rows.push({
      rowNum,
      cy: typeof c(1) === "number" ? (c(1) as number) : 2026,
      quarter: qNum,
      person: String(person).trim(),
      cardName: String(c(4) ?? "").trim(),
      benefitType: String(benefitType).trim(),
      provider: typeof c(6) === "string" ? String(c(6)).trim() || null : null,
      exactBenefit: typeof c(7) === "string" ? String(c(7)).trim() || null : null,
      excelFrequency: typeof c(8) === "string" ? String(c(8)).trim() || null : null,
      orderStatus: parseStatus(typeof rawStatus === "string" ? rawStatus : null),
      soldFor: typeof c(10) === "number" ? (c(10) as number) : null, // col 10 = "Sold for"
      cashValue: typeof c(11) === "number" ? (c(11) as number) : null, // col 11 = "Cash Value"
      orderDate: typeof c(12) === "string" ? (c(12) as string) : null,
      expiryDate: typeof c(13) === "string" ? (c(13) as string) : null,
      rupayBookingId: typeof c(14) === "string" ? String(c(14)).trim() || null : null,
      code: typeof c(15) === "string" ? String(c(15)).trim() || null : null,
      comments: typeof c(16) === "string" ? String(c(16)).trim() || null : null,
    });
  });
  return rows;
}

// ── Card name → catalog mapping ───────────────────────────────────────────────
interface CardDef {
  bctId: string;
  benefitMap: BenefitMap;
  lastDigits: string | null;
}

function classifyCard(cardName: string, person: string): CardDef | null {
  const n = cardName.toLowerCase();
  const digitMatch = cardName.match(/\((\d+)\)$/);
  const digits = digitMatch ? digitMatch[1] : null;

  if (n.includes("bob rupay eterna")) return null; // skip
  if (n.includes("boi rupay select credit")) {
    return { bctId: BCT.BOI_CREDIT, benefitMap: BOI_CREDIT_BENEFITS, lastDigits: null };
  }
  if (n.includes("pnb rupay select credit") || n === "pnb rupay select credit card") {
    return { bctId: BCT.PNB_CREDIT, benefitMap: PNB_CREDIT_BENEFITS, lastDigits: null };
  }
  if (n.includes("pnb rupay select imperial") || n.includes("pnb rupay select imperial dc")) {
    return { bctId: BCT.PNB_IMPERIAL, benefitMap: PNB_IMPERIAL_BENEFITS, lastDigits: digits };
  }
  if (n.includes("boi rupay select debit")) {
    // "BOI Rupay Select Debit Card" without digits: Sumit's 5159
    const lastDigits = digits ?? (person === "Sumit" ? "5159" : null);
    return { bctId: BCT.BOI_DEBIT, benefitMap: BOI_DEBIT_BENEFITS, lastDigits };
  }
  return null;
}

// Status priority (for deduplication)
const STATUS_PRIORITY: Record<string, number> = {
  "Not Ordered": 1,
  "Ordered but Coupon not received": 2,
  "Coupon Received": 3,
  "Skipped": 4,
  "Coupon Redeemed": 5,
  "Withdrawn": 6,
};

// ── Benefit lookup ────────────────────────────────────────────────────────────
function lookupBenefit(map: BenefitMap, benefitType: string, provider: string | null): BenefitEntry | null {
  const t = benefitType.toLowerCase().trim();
  const p = (provider ?? "").toLowerCase().trim();

  // Try exact "type|provider"
  let entry = map.get(`${t}|${p}`);
  if (entry) return entry;
  // Try "type|" (pick-one: no provider)
  entry = map.get(`${t}|`);
  if (entry) return entry;
  // Try partial provider match
  for (const [key, val] of map) {
    const [kt, kp] = key.split("|");
    if (kt === t && p && kp && p.includes(kp)) return val;
    if (kt === t && p && kp && kp.includes(p)) return val;
  }
  return null;
}

function lookupPickOneOption(benefitId: string, provider: string | null, exactBenefit: string | null): string | null {
  if (!provider) return null;
  const p = provider.toLowerCase().trim();
  const e = (exactBenefit ?? "").toLowerCase();

  // Try exact
  const exact = PICK_ONE_OPTIONS[`${benefitId}|${p}`];
  if (exact) return exact;

  // BOI Gym: distinguish by exactBenefit
  if (benefitId === "6c7012a4-ad5e-4f1a-b78f-f812976c9222") {
    if (e.includes("1 month")) return PICK_ONE_OPTIONS[`${benefitId}|cult.fit|1 month`] ?? null;
    if (e.includes("3 month")) return PICK_ONE_OPTIONS[`${benefitId}|cult.fit|3 month`] ?? null;
    return null;
  }

  // Fuzzy: first word of provider
  const firstWord = p.split(/\s+/)[0];
  for (const [key, val] of Object.entries(PICK_ONE_OPTIONS)) {
    if (key.startsWith(benefitId) && key.includes(firstWord)) return val;
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
interface Stats {
  holdersCreated: number;
  cardsCreated: number;
  cardsUpdated: number;
  instancesInserted: number;
  instancesUpdated: number;
  instancesSkipped: number;
  warnings: string[];
}

async function main() {
  const excelPath = path.resolve(__dirname, "../../../Gift Voucher Tracker.xlsx");
  console.log("Reading Excel:", excelPath);
  const excelRows = await parseExcel(excelPath);
  console.log(`Parsed ${excelRows.length} data rows from 'Rupay Select' sheet`);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  const stats: Stats = { holdersCreated: 0, cardsCreated: 0, cardsUpdated: 0, instancesInserted: 0, instancesUpdated: 0, instancesSkipped: 0, warnings: [] };

  try {
    // ── Step 1: Upsert holders ──────────────────────────────────────────────
    console.log("\n── Holders ──");
    const newHolders = ["Papa", "Mummy"];
    for (const name of newHolders) {
      const existing = await sql`SELECT id FROM app.card_holders WHERE workspace_id = ${WORKSPACE_ID} AND name = ${name}`;
      if (existing.length) {
        HOLDERS[name] = existing[0].id as string;
        console.log(`  ${name}: already exists (${existing[0].id})`);
      } else {
        if (WRITE) {
          const [row] = await sql`
            INSERT INTO app.card_holders (workspace_id, name, active)
            VALUES (${WORKSPACE_ID}, ${name}, true)
            RETURNING id
          `;
          HOLDERS[name] = row.id as string;
          console.log(`  ${name}: CREATED (${row.id})`);
        } else {
          console.log(`  ${name}: would CREATE`);
        }
        stats.holdersCreated++;
      }
    }

    // ── Step 2: Update existing cards (last_digits, display_name, trackingFrom) ──
    console.log("\n── Update existing cards ──");
    if (WRITE) {
      await sql`
        UPDATE app.cards SET last_digits = '5159', display_name = 'Bank of India RuPay Select Card (5159)', tracking_from = '2026-01-01'
        WHERE id = ${EXISTING_CARDS.BOI_5159.cardId}
      `;
      await sql`
        UPDATE app.cards SET last_digits = '7825', display_name = 'PNB Salary Imperial RuPay Select Card (7825)', tracking_from = '2026-04-01'
        WHERE id = ${EXISTING_CARDS.PNB_7825.cardId}
      `;
    }
    console.log(`  BOI → last_digits=5159, tracking_from=2026-01-01 ${WRITE ? "(done)" : "(dry-run)"}`);
    console.log(`  PNB 7825 → last_digits=7825, tracking_from=2026-04-01 ${WRITE ? "(done)" : "(dry-run)"}`);
    stats.cardsUpdated += 2;

    // ── Step 3: Determine which cards need to be created ────────────────────
    // Collect unique (person, cardName) combos from Excel, skip skipped card types
    const cardRegistry = new Map<string, string>(); // "person|bctId|lastDigits" → cardId

    // Register existing cards
    cardRegistry.set(`Sumit|${BCT.BOI_DEBIT}|5159`, EXISTING_CARDS.BOI_5159.cardId);
    cardRegistry.set(`Sumit|${BCT.PNB_IMPERIAL}|7825`, EXISTING_CARDS.PNB_7825.cardId);

    // Collect cards needed from Excel
    interface CardToCreate {
      person: string;
      bctId: string;
      lastDigits: string | null;
      displayName: string;
      trackingFrom: string; // earliest quarter start
    }
    const cardsToCreate = new Map<string, CardToCreate>();

    const quarterStarts: Record<number, string> = { 1: "2026-01-01", 2: "2026-04-01", 3: "2026-07-01", 4: "2026-10-01" };

    for (const row of excelRows) {
      const cardDef = classifyCard(row.cardName, row.person);
      if (!cardDef) continue; // skip (BoB Eterna, Golf-only, etc.)

      const holderId = HOLDERS[row.person];
      if (!holderId && !["Papa", "Mummy"].includes(row.person)) continue;

      const registryKey = `${row.person}|${cardDef.bctId}|${cardDef.lastDigits ?? ""}`;
      if (cardRegistry.has(registryKey)) {
        // Update earliest trackingFrom
        const existing2 = cardsToCreate.get(registryKey);
        if (existing2) {
          const qStart = quarterStarts[row.quarter];
          if (qStart < existing2.trackingFrom) existing2.trackingFrom = qStart;
        }
        continue;
      }

      const bctName: Record<string, string> = {
        [BCT.BOI_DEBIT]: "Bank of India RuPay Select Card",
        [BCT.PNB_IMPERIAL]: "PNB Salary Imperial RuPay Select Card",
        [BCT.BOI_CREDIT]: "Bank of India RuPay Select Credit Card",
        [BCT.PNB_CREDIT]: "Punjab National Bank Rupay Select Credit Card",
      };
      const baseName = bctName[cardDef.bctId] ?? "Card";
      const displayName = cardDef.lastDigits ? `${baseName} (${cardDef.lastDigits})` : `${baseName} (${row.person})`;

      cardsToCreate.set(registryKey, {
        person: row.person,
        bctId: cardDef.bctId,
        lastDigits: cardDef.lastDigits,
        displayName,
        trackingFrom: quarterStarts[row.quarter],
      });
    }

    // Create cards
    console.log("\n── Create new cards ──");
    for (const [key, card] of cardsToCreate) {
      const holderId = HOLDERS[card.person];
      if (!holderId) {
        stats.warnings.push(`No holderId for ${card.person} yet (create holder first)`);
        continue;
      }
      // Check if display_name already exists
      const existing2 = await sql`
        SELECT id FROM app.cards WHERE workspace_id = ${WORKSPACE_ID} AND display_name = ${card.displayName}
      `;
      if (existing2.length) {
        cardRegistry.set(key, existing2[0].id as string);
        console.log(`  ${card.displayName}: already exists (${existing2[0].id})`);
      } else {
        if (WRITE) {
          const [row] = await sql`
            INSERT INTO app.cards (workspace_id, holder_id, bank_card_type_id, display_name, last_digits, tracking_from, active)
            VALUES (${WORKSPACE_ID}, ${holderId}, ${card.bctId}, ${card.displayName}, ${card.lastDigits}, ${card.trackingFrom}, true)
            RETURNING id
          `;
          cardRegistry.set(key, row.id as string);
          console.log(`  ${card.displayName}: CREATED (${row.id})`);
        } else {
          const fakeId = `NEW_${key.replace(/[|]/g, "_")}`;
          cardRegistry.set(key, fakeId);
          console.log(`  ${card.displayName}: would CREATE`);
        }
        stats.cardsCreated++;
      }
    }

    // ── Step 4: Process benefit instances ───────────────────────────────────
    console.log("\n── Benefit instances ──");

    // Group rows by (registryKey, benefitId, periodLabel) for deduplication
    // For Monthly benefits, group by (registryKey, benefitId, monthIndex-within-quarter)
    // Key: "registryKey||benefitId||periodLabel||instanceIndex"
    interface InstanceKey {
      registryKey: string;
      benefitEntry: BenefitEntry;
      period: { start: string; end: string; label: string };
      instanceNumber: number;
    }
    interface InstanceData {
      key: InstanceKey;
      row: ExcelRow;
    }
    const instanceMap = new Map<string, InstanceData>();

    // Monthly benefit instance counter per (card, benefitId, quarter)
    const monthlyCounters = new Map<string, number>();

    for (const row of excelRows) {
      const cardDef = classifyCard(row.cardName, row.person);
      if (!cardDef) continue;

      // Skip benefit types not in catalog for this card type
      const benefit = lookupBenefit(cardDef.benefitMap, row.benefitType, row.provider);
      if (!benefit) {
        // Only warn if it's not a known skip (Golf for BOI, etc.)
        if (row.benefitType.toLowerCase() !== "golf program" || cardDef.bctId !== BCT.BOI_DEBIT) {
          stats.warnings.push(`Row ${row.rowNum}: no benefit found for "${row.benefitType}/${row.provider}" on ${row.cardName}`);
        }
        continue;
      }

      const registryKey = `${row.person}|${cardDef.bctId}|${cardDef.lastDigits ?? ""}`;
      if (!cardRegistry.has(registryKey)) continue; // card not created (shouldn't happen)

      // Determine period(s)
      const periods = getPeriod(row.cy, row.quarter, benefit.frequency);

      let period: { start: string; end: string; label: string };
      let instanceNumber = 1;

      if (benefit.frequency === "Monthly") {
        // Each row in the quarter = a separate monthly instance
        const monthlyKey = `${registryKey}||${benefit.id}||${row.cy}-Q${row.quarter}`;
        const idx = (monthlyCounters.get(monthlyKey) ?? 0);
        monthlyCounters.set(monthlyKey, idx + 1);
        period = periods[Math.min(idx, periods.length - 1)];
        // Use orderDate month if available
        if (row.orderDate) {
          const m = parseInt(row.orderDate.slice(5, 7), 10);
          const matchedPeriod = periods.find(p => parseInt(p.start.slice(5, 7), 10) === m);
          if (matchedPeriod) period = matchedPeriod;
        }
      } else {
        period = periods[0];
      }

      const mapKey = `${registryKey}||${benefit.id}||${period.label}||${instanceNumber}`;

      // Deduplication: keep higher-priority status
      if (instanceMap.has(mapKey)) {
        const existing3 = instanceMap.get(mapKey)!;
        if ((STATUS_PRIORITY[row.orderStatus] ?? 0) > (STATUS_PRIORITY[existing3.row.orderStatus] ?? 0)) {
          instanceMap.set(mapKey, { key: { registryKey, benefitEntry: benefit, period, instanceNumber }, row });
        }
      } else {
        instanceMap.set(mapKey, { key: { registryKey, benefitEntry: benefit, period, instanceNumber }, row });
      }
    }

    console.log(`  ${instanceMap.size} unique benefit instances to process`);

    // Load existing instances for reconciliation
    const existingInstances = await sql`
      SELECT id, card_id, benefit_id, period_start, period_label, instance_number, order_status, rupay_booking_id
      FROM app.benefit_instances
      WHERE workspace_id = ${WORKSPACE_ID}
    `;
    const existingMap = new Map<string, { id: string; orderStatus: string; rupayBookingId: string | null }>();
    for (const inst of existingInstances) {
      const key = `${inst.card_id}||${inst.benefit_id}||${inst.period_label}||${inst.instance_number}`;
      existingMap.set(key, { id: inst.id as string, orderStatus: inst.order_status as string, rupayBookingId: inst.rupay_booking_id as string | null });
    }

    let insertCount = 0, updateCount = 0, skipCount = 0;

    for (const [, { key: instKey, row }] of instanceMap) {
      const cardId = cardRegistry.get(instKey.registryKey);
      if (!cardId || cardId.startsWith("NEW_")) {
        // Card was not actually created (dry-run or error) — count as would-insert
        if (!WRITE) {
          console.log(`  [DRY] would INSERT: ${row.person}/${row.cardName} ${row.benefitType}/${row.provider} ${instKey.period.label} → ${row.orderStatus}`);
          insertCount++;
        }
        continue;
      }

      const bctId = instKey.benefitEntry.id === BCT.BOI_DEBIT ? BCT.BOI_DEBIT :
        (() => {
          // Determine bankCardTypeId from card
          return null; // will look up
        })();

      // Look up bankCardTypeId for this card
      let bankCardTypeId: string;
      const cardRow = await sql`SELECT bank_card_type_id FROM app.cards WHERE id = ${cardId}`;
      if (!cardRow.length) { stats.warnings.push(`Card ${cardId} not found`); continue; }
      bankCardTypeId = cardRow[0].bank_card_type_id as string;

      const existKey = `${cardId}||${instKey.benefitEntry.id}||${instKey.period.label}||${instKey.instanceNumber}`;
      const existing4 = existingMap.get(existKey);

      // Only record the chosen option when the benefit was actually acted on (not just "Not Ordered")
      const isActioned = row.orderStatus !== "Not Ordered";
      const chosenOptionId = (instKey.benefitEntry.pickOne && isActioned)
        ? lookupPickOneOption(instKey.benefitEntry.id, row.provider, row.exactBenefit)
        : null;
      const soldFor = row.soldFor != null ? String(row.soldFor.toFixed(2)) : null;

      if (existing4) {
        // Update if we have better data
        const currentPriority = STATUS_PRIORITY[existing4.orderStatus] ?? 0;
        const newPriority = STATUS_PRIORITY[row.orderStatus] ?? 0;

        const hasNewData = row.rupayBookingId || row.orderDate || row.code || row.cashValue != null || row.soldFor != null;
        const shouldUpdate = newPriority > currentPriority || (newPriority === currentPriority && hasNewData);

        if (!shouldUpdate) {
          skipCount++;
          continue;
        }

        if (WRITE) {
          // Encrypt code if present
          let codeEncrypted: string | null = null;
          if (row.code) {
            try { codeEncrypted = encryptCode(row.code, existing4.id); } catch { /* skip */ }
          }
          await sql`
            UPDATE app.benefit_instances SET
              order_status = ${row.orderStatus},
              sold_for = ${soldFor},
              cash_value = ${row.cashValue != null ? String(row.cashValue.toFixed(2)) : null},
              order_date = ${row.orderDate},
              expiry_date = ${row.expiryDate},
              rupay_booking_id = ${row.rupayBookingId},
              code_encrypted = COALESCE(${codeEncrypted}, code_encrypted),
              chosen_option_id = COALESCE(${chosenOptionId}, chosen_option_id),
              comments = COALESCE(${row.comments}, comments),
              updated_at = NOW()
            WHERE id = ${existing4.id}
          `;
          console.log(`  UPD: ${row.person} ${row.benefitType}/${row.provider ?? ""} ${instKey.period.label} → ${row.orderStatus} ${row.rupayBookingId ?? ""}`);
        } else {
          console.log(`  [DRY] UPD: ${row.person} ${row.benefitType}/${row.provider ?? ""} ${instKey.period.label} → ${row.orderStatus} ${row.rupayBookingId ?? ""}`);
        }
        updateCount++;
      } else {
        // Insert new
        if (WRITE) {
          const [newInst] = await sql`
            INSERT INTO app.benefit_instances (
              workspace_id, card_id, bank_card_type_id, benefit_id, generated_from_version,
              period_start, period_end, period_label, instance_number,
              order_status, sold_for, cash_value, order_date, expiry_date,
              order_deadline, rupay_booking_id, chosen_option_id, comments
            ) VALUES (
              ${WORKSPACE_ID}, ${cardId}, ${bankCardTypeId}, ${instKey.benefitEntry.id}, ${instKey.benefitEntry.versionId},
              ${instKey.period.start}, ${instKey.period.end}, ${instKey.period.label}, ${instKey.instanceNumber},
              ${row.orderStatus}, ${soldFor}, ${row.cashValue != null ? String(row.cashValue.toFixed(2)) : null},
              ${row.orderDate}, ${row.expiryDate},
              ${instKey.period.end}, ${row.rupayBookingId}, ${chosenOptionId}, ${row.comments}
            )
            ON CONFLICT (card_id, benefit_id, override_id, period_start, instance_number) DO NOTHING
            RETURNING id
          `;
          if (newInst) {
            // Encrypt and set code if present
            if (row.code) {
              try {
                const enc = encryptCode(row.code, newInst.id as string);
                await sql`UPDATE app.benefit_instances SET code_encrypted = ${enc} WHERE id = ${newInst.id}`;
              } catch { /* ignore */ }
            }
            console.log(`  INS: ${row.person} ${row.benefitType}/${row.provider ?? ""} ${instKey.period.label} → ${row.orderStatus} ${row.rupayBookingId ?? ""}`);
          }
        } else {
          console.log(`  [DRY] INS: ${row.person} ${row.benefitType}/${row.provider ?? ""} ${instKey.period.label} → ${row.orderStatus} ${row.rupayBookingId ?? ""}`);
        }
        insertCount++;
      }
    }

    stats.instancesInserted = insertCount;
    stats.instancesUpdated = updateCount;
    stats.instancesSkipped = skipCount;

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log("\n══ Summary ══════════════════════════════");
    console.log(`Mode: ${WRITE ? "WRITE" : "DRY RUN"}`);
    console.log(`Holders created: ${stats.holdersCreated}`);
    console.log(`Cards created:   ${stats.cardsCreated}`);
    console.log(`Cards updated:   ${stats.cardsUpdated}`);
    console.log(`Instances inserted: ${stats.instancesInserted}`);
    console.log(`Instances updated:  ${stats.instancesUpdated}`);
    console.log(`Instances skipped:  ${stats.instancesSkipped}`);
    if (stats.warnings.length) {
      console.log(`\nWarnings (${stats.warnings.length}):`);
      stats.warnings.slice(0, 20).forEach(w => console.log(`  ⚠ ${w}`));
    }
  } finally {
    await sql.end();
  }
}

main().catch(e => {
  console.error("Import failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
