// ─────────────────────────────────────────────────────────────────────────────
// JimsSheet — CSV Parser
// ─────────────────────────────────────────────────────────────────────────────

import type {
  DatabaseParser,
  DetectionResult,
  ParsedDatabase,
  ParsedTable,
  ColumnInfo,
  CellValue,
} from "./types";
import { ParseError } from "./types";

const MAX_ROWS = 100_000;

/** Detect the delimiter used in a CSV file */
function detectDelimiter(sample: string): string {
  const candidates = [",", "\t", ";", "|"];
  const firstLine = sample.split("\n")[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = (firstLine.match(new RegExp("\\" + d, "g")) ?? []).length;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

/** Parse a single CSV row respecting RFC 4180 quoting */
function parseCsvRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      // Quoted field
      let field = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 2; }
          else { i++; break; }
        } else {
          field += line[i++];
        }
      }
      cells.push(field);
      if (line[i] === delimiter) i++;
    } else {
      // Unquoted field
      const end = line.indexOf(delimiter, i);
      if (end === -1) {
        cells.push(line.slice(i));
        break;
      } else {
        cells.push(line.slice(i, end));
        i = end + 1;
      }
    }
  }
  return cells;
}

/** Try to coerce a string cell value to a more specific type */
function inferValue(raw: string): CellValue {
  if (raw === "" || raw.toLowerCase() === "null" || raw.toLowerCase() === "n/a" || raw === "\\N") return null;
  if (raw.toLowerCase() === "true") return true;
  if (raw.toLowerCase() === "false") return false;

  // Integer
  if (/^-?\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) return n;
  }

  // Decimal
  if (/^-?\d+\.\d+$/.test(raw)) {
    const n = parseFloat(raw);
    if (!isNaN(n)) return n;
  }

  // Date / datetime
  if (/^\d{4}-\d{2}-\d{2}(T[\d:Z.+-]+)?$/.test(raw)) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }

  return raw;
}

/** Infer column types from a sample of rows */
function inferColumns(header: string[], sampleRows: string[][]): ColumnInfo[] {
  return header.map((name, colIdx) => {
    const samples = sampleRows.map((r) => r[colIdx] ?? "").filter((v) => v !== "");
    let type: ColumnInfo["type"] = "text";

    if (samples.every((v) => /^-?\d+$/.test(v))) type = "integer";
    else if (samples.every((v) => /^-?\d+(\.\d+)?$/.test(v))) type = "decimal";
    else if (samples.every((v) => /^(true|false)$/i.test(v))) type = "boolean";
    else if (samples.every((v) => /^\d{4}-\d{2}-\d{2}(T[\d:Z.+-]+)?$/.test(v))) type = "datetime";

    return {
      name:        name.trim() || `Column${colIdx + 1}`,
      rawType:     type,
      type,
      nullable:    true,
      isPrimaryKey: false,
    };
  });
}

export const csvParser: DatabaseParser = {
  canHandle(detection: DetectionResult): boolean {
    return detection.format === "csv" && detection.supported;
  },

  async parse(
    file: File,
    _detection: DetectionResult,
    onProgress?: (msg: string) => void
  ): Promise<ParsedDatabase> {
    onProgress?.("Reading CSV file…");

    let text: string;
    try {
      text = await file.text();
    } catch {
      throw new ParseError("corrupted", "Could not read the file.");
    }

    onProgress?.("Detecting format…");
    const delimiter = detectDelimiter(text.slice(0, 4096));

    const lines = text.split(/\r?\n/);
    if (lines.length < 2) {
      throw new ParseError("empty", "The CSV file appears to be empty or has only a header row.");
    }

    onProgress?.("Parsing CSV data…");

    const headerLine = lines[0];
    const header = parseCsvRow(headerLine, delimiter);
    if (header.length === 0) {
      throw new ParseError("corrupted", "Could not parse the CSV header row.");
    }

    const rows: CellValue[][] = [];
    const rawSample: string[][] = [];

    for (let i = 1; i < lines.length && rows.length < MAX_ROWS; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const rawCells = parseCsvRow(line, delimiter);
      if (rawSample.length < 100) rawSample.push(rawCells);

      // Pad/trim to match header count
      while (rawCells.length < header.length) rawCells.push("");
      const coerced = rawCells.slice(0, header.length).map(inferValue);
      rows.push(coerced);
    }

    const columns = inferColumns(header, rawSample);

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const tableName = baseName || "Sheet1";

    const table: ParsedTable = {
      name:        tableName,
      columns,
      rows,
      totalRows:   rows.length,
      primaryKeys: [],
      foreignKeys: [],
      truncated:   rows.length >= MAX_ROWS,
    };

    return {
      tables: [table],
      metadata: {
        displayName: "CSV File",
        format:      "csv",
        supported:   true,
      },
    };
  },
};
