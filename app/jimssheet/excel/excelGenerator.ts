// ─────────────────────────────────────────────────────────────────────────────
// JimsSheet — Excel Generator
//
// Converts a ParsedDatabase into a professionally formatted .xlsx workbook
// using SheetJS (xlsx library).
//
// Sheet layout:
//   - One worksheet per table (data + bold frozen header + auto-filter)
//   - Summary worksheet (export metadata)
//   - Schema worksheet (column/type/key information)
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import type { ParsedDatabase, ParsedTable, ColumnInfo, CellValue } from "../parsers/types";

// ─── Sheet name sanitization ──────────────────────────────────────────────────

const INVALID_SHEET_CHARS = /[[\]:*?/\\]/g;
const MAX_SHEET_NAME_LEN  = 31;
const RESERVED_NAMES      = new Set(["History", "history"]);

function sanitizeSheetName(name: string, usedNames: Set<string>): string {
  let clean = name.replace(INVALID_SHEET_CHARS, "_").slice(0, MAX_SHEET_NAME_LEN).trim();
  if (!clean) clean = "Sheet";
  if (RESERVED_NAMES.has(clean)) clean = clean + "_";

  // Deduplicate
  let candidate = clean;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffixStr = String(suffix++);
    candidate = clean.slice(0, MAX_SHEET_NAME_LEN - 1 - suffixStr.length) + "_" + suffixStr;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

// ─── Formula injection protection ────────────────────────────────────────────

/** Cells starting with these chars may be interpreted as formulas by Excel */
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

function sanitizeForFormula(val: string): string {
  if (FORMULA_PREFIXES.has(val[0])) return "'" + val;
  return val;
}

// ─── Cell value → XLSX cell ───────────────────────────────────────────────────

function makeCell(val: CellValue, colType: ColumnInfo["type"]): XLSX.CellObject {
  if (val === null || val === undefined) {
    return { t: "z", v: undefined };
  }

  if (typeof val === "boolean") {
    return { t: "b", v: val };
  }

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return { t: "s", v: String(val) };
    const isDateOnly = colType === "date";
    return {
      t: "d",
      v: val,
      z: isDateOnly ? "YYYY-MM-DD" : "YYYY-MM-DD HH:MM:SS",
    };
  }

  if (typeof val === "number") {
    if (colType === "integer") return { t: "n", v: val, z: "0" };
    if (colType === "decimal") return { t: "n", v: val, z: "#,##0.##" };
    return { t: "n", v: val };
  }

  if (typeof val === "string") {
    const sanitized = sanitizeForFormula(val);
    return { t: "s", v: sanitized };
  }

  return { t: "s", v: String(val) };
}

// ─── Column width estimation ──────────────────────────────────────────────────

const MIN_COL_WIDTH = 8;
const MAX_COL_WIDTH = 50;

function estimateColWidth(colName: string, sampleValues: CellValue[]): number {
  let maxLen = colName.length;
  for (const v of sampleValues) {
    if (v === null || v === undefined) continue;
    const len = v instanceof Date ? 19 : String(v).length;
    if (len > maxLen) maxLen = len;
  }
  return Math.min(Math.max(maxLen + 2, MIN_COL_WIDTH), MAX_COL_WIDTH);
}

// ─── Table sheet builder ──────────────────────────────────────────────────────

function buildTableSheet(table: ParsedTable): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const range: XLSX.Range = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };

  const numCols = table.columns.length;
  const numRows = table.rows.length;

  range.e.r = numRows;
  range.e.c = numCols - 1;

  // ── Header row ────────────────────────────────────────────────────────────
  for (let c = 0; c < numCols; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    ws[addr] = {
      t: "s",
      v: table.columns[c].name,
      s: {
        font:  { bold: true, color: { rgb: "FFFFFF" } },
        fill:  { fgColor: { rgb: "1A7F5A" } },
        alignment: { vertical: "center", wrapText: false },
      },
    };
  }

  // ── Data rows ─────────────────────────────────────────────────────────────
  for (let r = 0; r < numRows; r++) {
    const row = table.rows[r];
    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: r + 1, c });
      ws[addr] = makeCell(row[c], table.columns[c].type);
    }
  }

  ws["!ref"] = XLSX.utils.encode_range(range);

  // ── Freeze header row ─────────────────────────────────────────────────────
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  // ── Auto-filter ───────────────────────────────────────────────────────────
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } }) };

  // ── Column widths ─────────────────────────────────────────────────────────
  ws["!cols"] = table.columns.map((col, c) => {
    const sample = table.rows.slice(0, 200).map((r) => r[c]);
    return { wch: estimateColWidth(col.name, sample) };
  });

  // ── Row heights ───────────────────────────────────────────────────────────
  ws["!rows"] = [{ hpt: 20 }]; // header row height

  return ws;
}

// ─── Summary sheet ────────────────────────────────────────────────────────────

function buildSummarySheet(db: ParsedDatabase, sourceFilename: string, exportedTables: ParsedTable[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};

  const now = new Date();
  const totalRows = exportedTables.reduce((sum, t) => sum + t.totalRows, 0);

  const metaRows: [string, string | number | Date][] = [
    ["Source File",     sourceFilename],
    ["Database Type",   db.metadata.displayName],
    ["Export Date",     now],
    ["Tables Exported", exportedTables.length],
    ["Total Rows",      totalRows],
    ["",                ""],
  ];

  let r = 0;

  // Title
  ws[XLSX.utils.encode_cell({ r: r++, c: 0 })] = {
    t: "s", v: "JimsSheet Export Summary",
    s: { font: { bold: true, sz: 14 } },
  };
  ws[XLSX.utils.encode_cell({ r: r++, c: 0 })] = { t: "z", v: undefined };

  // Metadata
  for (const [label, value] of metaRows) {
    ws[XLSX.utils.encode_cell({ r, c: 0 })] = { t: "s", v: label, s: { font: { bold: true } } };
    if (value instanceof Date) {
      ws[XLSX.utils.encode_cell({ r, c: 1 })] = { t: "d", v: value, z: "YYYY-MM-DD HH:MM:SS" };
    } else if (typeof value === "number") {
      ws[XLSX.utils.encode_cell({ r, c: 1 })] = { t: "n", v: value };
    } else {
      ws[XLSX.utils.encode_cell({ r, c: 1 })] = { t: "s", v: String(value) };
    }
    r++;
  }

  // Table list header
  const headerRow = r;
  ws[XLSX.utils.encode_cell({ r, c: 0 })] = { t: "s", v: "Table", s: { font: { bold: true } } };
  ws[XLSX.utils.encode_cell({ r, c: 1 })] = { t: "s", v: "Rows", s: { font: { bold: true } } };
  ws[XLSX.utils.encode_cell({ r, c: 2 })] = { t: "s", v: "Columns", s: { font: { bold: true } } };
  ws[XLSX.utils.encode_cell({ r, c: 3 })] = { t: "s", v: "Truncated", s: { font: { bold: true } } };
  r++;

  for (const table of exportedTables) {
    ws[XLSX.utils.encode_cell({ r, c: 0 })] = { t: "s", v: table.name };
    ws[XLSX.utils.encode_cell({ r, c: 1 })] = { t: "n", v: table.totalRows };
    ws[XLSX.utils.encode_cell({ r, c: 2 })] = { t: "n", v: table.columns.length };
    ws[XLSX.utils.encode_cell({ r, c: 3 })] = { t: "s", v: table.truncated ? "Yes (capped at 100,000 rows)" : "No" };
    r++;
  }

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: 3 } });
  ws["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 30 }];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: 3 } }) };

  return ws;
}

// ─── Schema sheet ─────────────────────────────────────────────────────────────

function buildSchemaSheet(exportedTables: ParsedTable[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};

  const headers = ["Table", "Column", "Type", "Raw Type", "Nullable", "Primary Key"];
  let r = 0;

  for (let c = 0; c < headers.length; c++) {
    ws[XLSX.utils.encode_cell({ r, c })] = {
      t: "s", v: headers[c],
      s: { font: { bold: true } },
    };
  }
  r++;

  for (const table of exportedTables) {
    for (const col of table.columns) {
      ws[XLSX.utils.encode_cell({ r, c: 0 })] = { t: "s", v: table.name };
      ws[XLSX.utils.encode_cell({ r, c: 1 })] = { t: "s", v: col.name };
      ws[XLSX.utils.encode_cell({ r, c: 2 })] = { t: "s", v: col.type };
      ws[XLSX.utils.encode_cell({ r, c: 3 })] = { t: "s", v: col.rawType };
      ws[XLSX.utils.encode_cell({ r, c: 4 })] = { t: "b", v: col.nullable };
      ws[XLSX.utils.encode_cell({ r, c: 5 })] = { t: "b", v: col.isPrimaryKey };
      r++;
    }
  }

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: r - 1, c: 5 } });
  ws["!cols"] = [{ wch: 24 }, { wch: 24 }, { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 14 }];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }) };

  return ws;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface GenerateResult {
  /** The generated workbook as an ArrayBuffer */
  buffer: ArrayBuffer;
  /** Suggested filename */
  filename: string;
  /** Number of data sheets created */
  sheetCount: number;
  /** Total rows written across all data sheets */
  totalRows: number;
}

export function generateExcel(
  db: ParsedDatabase,
  selectedTables: ParsedTable[],
  sourceFilename: string
): GenerateResult {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  let totalRows = 0;
  const tableSheets: { table: ParsedTable; sheetName: string }[] = [];

  // Reserve names for special sheets
  usedNames.add("summary");
  usedNames.add("schema");

  // ── Data sheets ───────────────────────────────────────────────────────────
  for (const table of selectedTables) {
    const sheetName = sanitizeSheetName(table.name, usedNames);
    const ws = buildTableSheet(table);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    tableSheets.push({ table, sheetName });
    totalRows += table.totalRows;
  }

  // ── Summary sheet ─────────────────────────────────────────────────────────
  const summaryWs = buildSummarySheet(db, sourceFilename, selectedTables);
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  // ── Schema sheet ──────────────────────────────────────────────────────────
  if (selectedTables.some((t) => t.columns.length > 0)) {
    const schemaWs = buildSchemaSheet(selectedTables);
    XLSX.utils.book_append_sheet(wb, schemaWs, "Schema");
  }

  // ── Generate output filename ──────────────────────────────────────────────
  const baseName = sourceFilename.replace(/\.[^/.]+$/, "");
  const filename  = (baseName || "database") + ".xlsx";

  // ── Write workbook ────────────────────────────────────────────────────────
  const rawBuffer = XLSX.write(wb, {
    type:        "array",
    bookType:    "xlsx",
    compression: true,
  }) as Uint8Array;

  // Coerce to plain ArrayBuffer for broad compatibility
  const buffer: ArrayBuffer = rawBuffer.buffer.slice(
    rawBuffer.byteOffset,
    rawBuffer.byteOffset + rawBuffer.byteLength
  ) as ArrayBuffer;

  return {
    buffer,
    filename,
    sheetCount: tableSheets.length,
    totalRows,
  };
}
