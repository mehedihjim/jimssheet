// ─────────────────────────────────────────────────────────────────────────────
// JimsSheet — SQL Dump Parser
//
// Parses MySQL, MariaDB, PostgreSQL, and generic SQL dump files by reading
// CREATE TABLE and INSERT INTO / COPY … FROM STDIN statements.
//
// No SQL is executed against a live database — this is a purely textual parser.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  DatabaseParser,
  DetectionResult,
  ParsedDatabase,
  ParsedTable,
  ColumnInfo,
  ForeignKeyInfo,
  CellValue,
} from "./types";
import { ParseError, normaliseColumnType } from "./types";

const MAX_ROWS_PER_TABLE = 100_000;

// ─── Tokeniser helpers ────────────────────────────────────────────────────────

/** Extract a quoted string starting at pos, returns [value, nextPos] */
function readQuotedString(text: string, pos: number, quote: string): [string, number] {
  let result = "";
  let i = pos + 1; // skip opening quote
  while (i < text.length) {
    const ch = text[i];
    if (ch === quote) {
      if (text[i + 1] === quote) {
        // Escaped quote
        result += quote;
        i += 2;
      } else {
        return [result, i + 1];
      }
    } else if (ch === "\\" && quote === "'") {
      // MySQL-style backslash escapes
      const next = text[i + 1];
      if (next === "n") result += "\n";
      else if (next === "r") result += "\r";
      else if (next === "t") result += "\t";
      else if (next === "0") result += "\0";
      else result += next ?? "";
      i += 2;
    } else {
      result += ch;
      i++;
    }
  }
  return [result, i];
}

/** Parse a VALUES row like (val1, val2, 'text', NULL) */
function parseValuesRow(text: string, start: number): [CellValue[], number] | null {
  let i = start;
  while (i < text.length && text[i] !== "(") i++;
  if (i >= text.length) return null;
  i++; // skip '('

  const values: CellValue[] = [];
  let depth = 0;

  while (i < text.length) {
    // Skip whitespace
    while (i < text.length && /\s/.test(text[i]) && depth === 0) {
      if (text[i] === "\n" && values.length === 0) { i++; continue; }
      i++;
    }

    const ch = text[i];

    if (ch === ")") {
      if (depth === 0) return [values, i + 1];
      depth--;
      i++;
      continue;
    }

    if (ch === "(") {
      depth++;
      i++;
      continue;
    }

    if (depth > 0) { i++; continue; }

    if (ch === "'" || ch === '"') {
      const [val, nextPos] = readQuotedString(text, i, ch);
      values.push(val);
      i = nextPos;
    } else if (text.slice(i, i + 4).toUpperCase() === "NULL") {
      values.push(null);
      i += 4;
    } else if (text.slice(i, i + 4).toUpperCase() === "TRUE") {
      values.push(true);
      i += 4;
    } else if (text.slice(i, i + 5).toUpperCase() === "FALSE") {
      values.push(false);
      i += 5;
    } else {
      // Number or identifier — read until comma/paren
      let token = "";
      while (i < text.length && text[i] !== "," && text[i] !== ")" && text[i] !== "\n") {
        token += text[i++];
      }
      token = token.trim();
      const num = Number(token);
      values.push(isNaN(num) || token === "" ? (token || null) : num);
      continue;
    }

    // Skip comma
    while (i < text.length && (text[i] === "," || text[i] === " " || text[i] === "\t")) i++;
  }

  return null;
}

// ─── CREATE TABLE parser ──────────────────────────────────────────────────────

interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
}

const RE_BACKTICK  = /`([^`]+)`/;
const RE_DQUOTE    = /"([^"]+)"/;
const RE_BRACKET   = /\[([^\]]+)\]/;
const RE_PLAIN     = /^(\w+)/;

function extractIdentifier(str: string): string | null {
  return (
    RE_BACKTICK.exec(str)?.[1] ??
    RE_DQUOTE.exec(str)?.[1] ??
    RE_BRACKET.exec(str)?.[1] ??
    RE_PLAIN.exec(str)?.[1] ??
    null
  );
}

function parseCreateTable(block: string): TableSchema | null {
  // Extract table name from "CREATE TABLE [IF NOT EXISTS] <name>"
  const tableMatch = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?\S+[`"\]]?)/i.exec(block);
  if (!tableMatch) return null;

  const tableName = extractIdentifier(tableMatch[1]) ?? tableMatch[1];

  // Find the body between first ( and the last ) before the semicolon
  const bodyStart = block.indexOf("(");
  if (bodyStart === -1) return null;

  // Find matching closing paren
  let depth = 0;
  let bodyEnd = -1;
  for (let i = bodyStart; i < block.length; i++) {
    if (block[i] === "(") depth++;
    else if (block[i] === ")") {
      depth--;
      if (depth === 0) { bodyEnd = i; break; }
    }
  }
  if (bodyEnd === -1) return null;

  const body = block.slice(bodyStart + 1, bodyEnd);

  // Split body into column/constraint definitions
  const lines = splitColumnDefs(body);

  const columns: ColumnInfo[] = [];
  const primaryKeys: string[] = [];
  const foreignKeys: ForeignKeyInfo[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();

    // PRIMARY KEY constraint line
    if (upper.startsWith("PRIMARY KEY")) {
      const pkMatch = /\(([^)]+)\)/.exec(trimmed);
      if (pkMatch) {
        pkMatch[1].split(",").map((s) => extractIdentifier(s.trim()) ?? "").filter(Boolean).forEach((k) => {
          primaryKeys.push(k);
          const col = columns.find((c) => c.name === k);
          if (col) col.isPrimaryKey = true;
        });
      }
      continue;
    }

    // FOREIGN KEY constraint line
    if (upper.startsWith("FOREIGN KEY") || upper.startsWith("CONSTRAINT")) {
      const fkMatch = /FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+[`"\[]?(\w+)[`"\]]?\s*\(([^)]+)\)/i.exec(trimmed);
      if (fkMatch) {
        foreignKeys.push({
          column:           extractIdentifier(fkMatch[1]) ?? fkMatch[1],
          referencedTable:  fkMatch[2],
          referencedColumn: extractIdentifier(fkMatch[3]) ?? fkMatch[3],
        });
      }
      continue;
    }

    // Skip other constraint lines
    if (upper.startsWith("UNIQUE") || upper.startsWith("INDEX") ||
        upper.startsWith("KEY ") || upper.startsWith("CHECK")) {
      continue;
    }

    // Column definition: <name> <type> [constraints...]
    const colName = extractIdentifier(trimmed);
    if (!colName) continue;

    // Remove the name and extract the type
    let rest = trimmed.slice(trimmed.indexOf(colName) + colName.length).trim();
    // Handle cases where name was quoted and rest starts after closing quote
    if (rest.startsWith("`") || rest.startsWith('"') || rest.startsWith("]")) {
      rest = rest.slice(1).trim();
    }

    const typeMatch = /^([A-Z_]+(?:\([^)]*\))?)/i.exec(rest);
    const rawType = typeMatch?.[1] ?? "TEXT";
    const upperRest = rest.toUpperCase();

    const notNull = upperRest.includes("NOT NULL");
    const isPK    = upperRest.includes("PRIMARY KEY");
    if (isPK) primaryKeys.push(colName);

    columns.push({
      name:        colName,
      rawType,
      type:        normaliseColumnType(rawType),
      nullable:    !notNull,
      isPrimaryKey: isPK,
    });
  }

  return { name: tableName, columns, primaryKeys, foreignKeys };
}

/** Split column definitions respecting parentheses depth */
function splitColumnDefs(body: string): string[] {
  const defs: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (inString) {
      current += ch;
      if (ch === stringChar && body[i - 1] !== "\\") inString = false;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }

    if (ch === "(") { depth++; current += ch; continue; }
    if (ch === ")") { depth--; current += ch; continue; }

    if (ch === "," && depth === 0) {
      defs.push(current);
      current = "";
      continue;
    }

    current += ch;
  }
  if (current.trim()) defs.push(current);
  return defs;
}

// ─── PostgreSQL COPY parser ───────────────────────────────────────────────────

function parsePgCopyBlock(block: string, schema: TableSchema): CellValue[][] {
  // Format: COPY tablename (col1, col2) FROM stdin;\n<data>\n\.
  const dataStart = block.indexOf("\n");
  if (dataStart === -1) return [];
  const dataBlock = block.slice(dataStart + 1);

  const rows: CellValue[][] = [];
  for (const line of dataBlock.split("\n")) {
    if (line === "\\." || line.trimStart().startsWith("\\")) break;
    if (!line.trim()) continue;

    const cells = line.split("\t").map((cell, i) => {
      if (cell === "\\N") return null;
      // Unescape PostgreSQL tab-format escapes
      const unescaped = cell
        .replace(/\\t/g, "\t")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\\\/g, "\\");

      const colType = schema.columns[i]?.type ?? "unknown";
      return coerceCellValue(unescaped, colType);
    });
    rows.push(cells);
    if (rows.length >= MAX_ROWS_PER_TABLE) break;
  }
  return rows;
}

function coerceCellValue(raw: string, colType: ColumnInfo["type"]): CellValue {
  if (raw === "" || raw === "NULL") return null;
  if (colType === "boolean") return raw === "1" || raw.toLowerCase() === "true" || raw === "t";
  if (colType === "integer") { const n = parseInt(raw, 10); return isNaN(n) ? raw : n; }
  if (colType === "decimal") { const n = parseFloat(raw); return isNaN(n) ? raw : n; }
  if (colType === "date" || colType === "datetime") {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d;
  }
  return raw;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export const sqlDumpParser: DatabaseParser = {
  canHandle(detection: DetectionResult): boolean {
    return detection.format === "sql_dump" && detection.supported;
  },

  async parse(
    file: File,
    detection: DetectionResult,
    onProgress?: (msg: string) => void
  ): Promise<ParsedDatabase> {
    onProgress?.("Reading SQL dump file…");

    let text: string;
    try {
      text = await file.text();
    } catch {
      throw new ParseError("corrupted", "Could not read the file. It may be corrupted.");
    }

    onProgress?.("Analyzing database structure…");

    // ── Pass 1: Collect CREATE TABLE blocks ───────────────────────────────────
    const schemas = new Map<string, TableSchema>();

    // Match CREATE TABLE ... ; (possibly multi-line)
    const createTableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(]+\s*\([\s\S]+?;/gi;
    let m: RegExpExecArray | null;
    while ((m = createTableRe.exec(text)) !== null) {
      const schema = parseCreateTable(m[0]);
      if (schema && schema.columns.length > 0) {
        schemas.set(schema.name.toLowerCase(), schema);
      }
    }

    onProgress?.(`Found ${schemas.size} table(s). Reading data…`);

    // ── Pass 2: Collect data ──────────────────────────────────────────────────
    const tableData = new Map<string, CellValue[][]>();

    const isPostgres = detection.dialect === "postgresql";

    if (isPostgres) {
      // Parse COPY ... FROM stdin; \n<data>\n\.
      const copyRe = /COPY\s+(?:\w+\.)?([`"\[]?\w+[`"\]]?)\s*\([^)]*\)\s*FROM\s*stdin;([\s\S]*?)\\\.(\s|$)/gi;
      while ((m = copyRe.exec(text)) !== null) {
        const name = extractIdentifier(m[1]) ?? m[1];
        const key = name.toLowerCase();
        const schema = schemas.get(key);
        if (schema) {
          const rows = parsePgCopyBlock(m[0], schema);
          const existing = tableData.get(key) ?? [];
          tableData.set(key, [...existing, ...rows].slice(0, MAX_ROWS_PER_TABLE));
        }
      }
    }

    // Parse INSERT INTO ... VALUES ... ; (MySQL, generic, also PostgreSQL fallback)
    // We stream through the text to avoid huge regex matches
    let pos = 0;
    const upperText = text.toUpperCase();

    while (pos < upperText.length) {
      const insertIdx = upperText.indexOf("INSERT INTO ", pos);
      if (insertIdx === -1) break;

      // Extract table name
      let nameStart = insertIdx + 12;
      while (nameStart < text.length && /\s/.test(text[nameStart])) nameStart++;
      const nameIdent = extractIdentifier(text.slice(nameStart)) ?? "";
      const key = nameIdent.toLowerCase();

      // Find VALUES keyword
      const valuesIdx = upperText.indexOf("VALUES", nameStart + nameIdent.length);
      if (valuesIdx === -1 || valuesIdx - nameStart > 500) {
        pos = insertIdx + 12;
        continue;
      }

      const schema = schemas.get(key);
      const existing = tableData.get(key) ?? [];

      if (schema && existing.length < MAX_ROWS_PER_TABLE) {
        // Parse potentially multiple value groups: VALUES (...),(...)
        let scanPos = valuesIdx + 6;
        while (scanPos < text.length) {
          // Skip whitespace and commas
          while (scanPos < text.length && /[\s,]/.test(text[scanPos])) scanPos++;
          if (text[scanPos] !== "(") break;

          const result = parseValuesRow(text, scanPos);
          if (!result) break;
          const [values, nextPos] = result;

          // Coerce types using schema
          const coerced = values.map((v, i) => {
            if (v === null || v === undefined) return null;
            const col = schema.columns[i];
            if (!col) return v;
            if (typeof v === "string") return coerceCellValue(v, col.type);
            return v;
          });

          existing.push(coerced);
          scanPos = nextPos;

          if (existing.length >= MAX_ROWS_PER_TABLE) break;
          // Check if next char is ',' (more values) or ';' (end)
          let peekPos = nextPos;
          while (peekPos < text.length && /[\s]/.test(text[peekPos])) peekPos++;
          if (text[peekPos] !== ",") break;
        }
        tableData.set(key, existing);
        pos = scanPos;
      } else {
        pos = insertIdx + 12;
      }
    }

    onProgress?.("Building table results…");

    // ── Combine schemas + data ─────────────────────────────────────────────────
    const tables: ParsedTable[] = [];

    for (const [key, schema] of schemas) {
      const rows = tableData.get(key) ?? [];
      tables.push({
        name:        schema.name,
        columns:     schema.columns,
        rows,
        totalRows:   rows.length,
        primaryKeys: schema.primaryKeys,
        foreignKeys: schema.foreignKeys,
        truncated:   rows.length >= MAX_ROWS_PER_TABLE,
      });
    }

    // If no schemas found but we have INSERT data, try best-effort
    if (tables.length === 0) {
      throw new ParseError(
        "empty",
        "We detected an SQL dump file, but could not find any table definitions (CREATE TABLE statements).",
        "The file may only contain data without schema definitions, or may use an unsupported syntax."
      );
    }

    const dialectDisplay: Record<string, string> = {
      mysql:      "MySQL Database Dump",
      mariadb:    "MariaDB Database Dump",
      postgresql: "PostgreSQL Database Dump",
      generic:    "SQL Database Dump",
    };

    return {
      tables,
      metadata: {
        displayName: dialectDisplay[detection.dialect ?? "generic"] ?? "SQL Database Dump",
        format:      "sql_dump",
        dialect:     detection.dialect,
        supported:   true,
      },
    };
  },
};
