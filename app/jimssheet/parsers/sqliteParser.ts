// ─────────────────────────────────────────────────────────────────────────────
// JimsSheet — SQLite Parser
//
// Uses sql.js (SQLite compiled to WebAssembly) to open and read SQLite
// database files entirely in the browser.
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
import type SqlJs from "sql.js";

// sql.js is loaded dynamically so Next.js doesn't try to SSR the WASM module.
let sqlJsInstance: SqlJs.SqlJsStatic | null = null;

async function getSqlJs(): Promise<SqlJs.SqlJsStatic> {
  if (sqlJsInstance) return sqlJsInstance;
  // Dynamically import sql.js and initialise with the wasm file served from /public/
  const initSqlJs = (await import("sql.js")).default;
  sqlJsInstance = await initSqlJs({
    locateFile: (filename: string) => {
      if (filename.endsWith(".wasm")) return "/sql-wasm.wasm";
      return filename;
    },
  });
  return sqlJsInstance;
}

// ─── Column type → ColumnInfo ─────────────────────────────────────────────────

function makeColumn(
  name: string,
  rawType: string,
  notNull: boolean,
  isPK: boolean
): ColumnInfo {
  return {
    name,
    rawType: rawType || "TEXT",
    type:    normaliseColumnType(rawType || "TEXT"),
    nullable: !notNull,
    isPrimaryKey: isPK,
  };
}

// ─── Value coercion ───────────────────────────────────────────────────────────

function coerceValue(raw: SqlJs.SqlValue, colType: ColumnInfo["type"]): CellValue {
  if (raw === null || raw === undefined) return null;

  // sql.js returns typed values already (number, string, Uint8Array)
  if (raw instanceof Uint8Array) return "[BLOB]";

  if (colType === "boolean") return Boolean(Number(raw));
  if (colType === "date") {
    const d = new Date(String(raw));
    return isNaN(d.getTime()) ? String(raw) : d;
  }
  if (colType === "datetime") {
    const d = new Date(String(raw));
    return isNaN(d.getTime()) ? String(raw) : d;
  }
  return raw as CellValue;
}

// ─── Row cap ──────────────────────────────────────────────────────────────────

const MAX_ROWS_PER_TABLE = 100_000;

// ─── Parser ───────────────────────────────────────────────────────────────────

export const sqliteParser: DatabaseParser = {
  canHandle(detection: DetectionResult): boolean {
    return detection.format === "sqlite" && detection.supported;
  },

  async parse(
    file: File,
    _detection: DetectionResult,
    onProgress?: (msg: string) => void
  ): Promise<ParsedDatabase> {
    onProgress?.("Loading SQLite engine…");

    let SQL: SqlJs.SqlJsStatic;
    try {
      SQL = await getSqlJs();
    } catch {
      throw new ParseError("corrupted", "Failed to load the SQLite engine. Please try refreshing the page.");
    }

    onProgress?.("Reading database file…");

    let db: SqlJs.Database;
    try {
      const arrayBuf = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuf);
      db = new SQL.Database(uint8);
    } catch {
      throw new ParseError("corrupted", "This file appears to be a damaged or incomplete SQLite database.");
    }

    onProgress?.("Reading database structure…");

    // Get all user tables (exclude sqlite_* internal tables)
    let tableNames: string[];
    try {
      const result = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      );
      tableNames = result.length > 0
        ? (result[0].values.map((r: SqlJs.SqlValue[]) => String(r[0])) as string[])
        : [];
    } catch {
      db.close();
      throw new ParseError("corrupted", "Could not read the database structure.");
    }

    if (tableNames.length === 0) {
      db.close();
      throw new ParseError("empty", "We detected the database, but it doesn't contain any tables to export.");
    }

    onProgress?.(`Finding tables… (${tableNames.length} found)`);

    const tables: ParsedTable[] = [];

    for (const tableName of tableNames) {
      onProgress?.(`Reading table: ${tableName}…`);

      try {
        // PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
        const pragmaResult = db.exec(`PRAGMA table_info("${escapeSqliteIdent(tableName)}")`);
        const columns: ColumnInfo[] = [];

        if (pragmaResult.length > 0) {
          for (const row of pragmaResult[0].values as SqlJs.SqlValue[][]) {
            const colName  = String(row[1]);
            const colType  = String(row[2] ?? "");
            const notNull  = Number(row[3]) === 1;
            const isPK     = Number(row[5]) > 0;
            columns.push(makeColumn(colName, colType, notNull, isPK));
          }
        }

        // Foreign keys
        const fkResult = db.exec(`PRAGMA foreign_key_list("${escapeSqliteIdent(tableName)}")`);
        const foreignKeys: ForeignKeyInfo[] = [];
        if (fkResult.length > 0) {
          for (const row of fkResult[0].values as SqlJs.SqlValue[][]) {
            foreignKeys.push({
              column:           String(row[3]),
              referencedTable:  String(row[2]),
              referencedColumn: String(row[4]),
            });
          }
        }

        // Row count
        const countResult = db.exec(`SELECT COUNT(*) FROM "${escapeSqliteIdent(tableName)}"`);
        const totalRows = countResult.length > 0 ? Number(countResult[0].values[0][0]) : 0;

        // Fetch rows (capped)
        const rowsResult = db.exec(
          `SELECT * FROM "${escapeSqliteIdent(tableName)}" LIMIT ${MAX_ROWS_PER_TABLE}`
        );

        const rows: CellValue[][] = [];
        if (rowsResult.length > 0) {
          for (const rawRow of rowsResult[0].values as SqlJs.SqlValue[][]) {
            const coerced = rawRow.map((val, i) => coerceValue(val, columns[i]?.type ?? "unknown"));
            rows.push(coerced);
          }
        }

        const primaryKeys = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

        tables.push({
          name: tableName,
          columns,
          rows,
          totalRows,
          primaryKeys,
          foreignKeys,
          truncated: totalRows > MAX_ROWS_PER_TABLE,
        });
      } catch (e) {
        // Skip tables that can't be read rather than failing entirely
        console.warn(`Skipping table "${tableName}":`, e);
      }
    }

    db.close();

    if (tables.length === 0) {
      throw new ParseError("empty", "We detected the database, but could not read any table data.");
    }

    return {
      tables,
      metadata: {
        displayName: "SQLite Database",
        format:      "sqlite",
        supported:   true,
      },
    };
  },
};

function escapeSqliteIdent(name: string): string {
  return name.replace(/"/g, '""');
}
