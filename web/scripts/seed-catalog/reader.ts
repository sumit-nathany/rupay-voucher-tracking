import ExcelJS from "exceljs";
import { RawRow, Secret } from "./types";

export const DEFAULT_WORKBOOK =
  "/Users/snathany/sumit_workdir/Personal/rupay-voucher-tracking/Gift Voucher Tracker.xlsx";
export const SHEET_NAME = "Rupay Select";

/** Header cells contain newlines ("Sold \nfor"); normalise to lowercase single-spaced. */
const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const COLUMNS = [
  "cy",
  "quarter",
  "person",
  "card",
  "benefit type",
  "benefit provider",
  "exact benefit",
  "frequency",
  "order status",
  "sold for",
  "cash value",
  "order date",
  "expiry date",
  "rupay booking id",
  "code",
  "comments",
] as const;

/** Flatten ExcelJS cell values (rich text, formulas, hyperlinks) to a primitive. */
function primitive(v: ExcelJS.CellValue): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("result" in o) return primitive(o.result as ExcelJS.CellValue);
    if (typeof o.text === "string") return o.text;
  }
  return null;
}

/** Rules 2 + 3: trim, '' -> null. Numbers are stringified. */
function str(v: ExcelJS.CellValue): string | null {
  const p = primitive(v);
  if (p === null || p instanceof Date) return null;
  const s = String(p).trim();
  return s === "" ? null : s;
}

function num(v: ExcelJS.CellValue): number | null {
  const p = primitive(v);
  if (p === null || p instanceof Date) return null;
  if (typeof p === "number") return Number.isFinite(p) ? p : null;
  const s = p.trim().replace(/,/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: ExcelJS.CellValue): string | null {
  const p = primitive(v);
  if (p instanceof Date) return p.toISOString().slice(0, 10);
  return null; // plan: real datetimes only, no string dates
}

export async function readRawRows(
  path: string = DEFAULT_WORKBOOK,
  sheetName: string = SHEET_NAME,
): Promise<RawRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);

  const header = ws.getRow(1);
  const col: Record<string, number> = {};
  header.eachCell((cell, c) => {
    col[norm(cell.value)] = c;
  });
  for (const name of COLUMNS) {
    if (!(name in col)) throw new Error(`Missing column "${name}" in header row`);
  }
  const cell = (row: ExcelJS.Row, name: (typeof COLUMNS)[number]) => row.getCell(col[name]).value;

  const out: RawRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const person = str(cell(row, "person"));
    const card = str(cell(row, "card"));
    // Rule 1: import only if Person or Card is populated.
    if (person === null && card === null) return;

    const cyN = num(cell(row, "cy"));
    const code = str(cell(row, "code"));
    const booking = str(cell(row, "rupay booking id"));
    out.push({
      rowNumber,
      cy: cyN === null ? null : Math.round(cyN), // rule 4
      quarter: str(cell(row, "quarter")),
      person,
      card,
      benefitType: str(cell(row, "benefit type")),
      provider: str(cell(row, "benefit provider")),
      exactBenefit: str(cell(row, "exact benefit")),
      frequency: str(cell(row, "frequency")),
      orderStatus: str(cell(row, "order status")),
      soldFor: num(cell(row, "sold for")),
      cashValue: num(cell(row, "cash value")),
      orderDate: isoDate(cell(row, "order date")),
      expiryDate: isoDate(cell(row, "expiry date")),
      bookingId: booking === null ? null : new Secret(booking),
      code: code === null ? null : new Secret(code),
      comments: str(cell(row, "comments")),
    });
  });
  return out;
}
