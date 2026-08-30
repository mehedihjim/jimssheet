// ─────────────────────────────────────────────────────────────────────────────
// JimsSheet — Format Detector
//
// Inspects a file using multiple signals:
//   1. Magic bytes (file signature)
//   2. File extension
//   3. Text content heuristics (first 8KB)
//
// Returns a DetectionResult with format, confidence, and whether parsing
// is currently supported.
// ─────────────────────────────────────────────────────────────────────────────

import type { DetectionResult, DatabaseFormat, SqlDialect } from "../parsers/types";

// ─── Magic byte signatures ────────────────────────────────────────────────────

const SQLITE_MAGIC = "SQLite format 3\0"; // 16 bytes, offset 0
const REDIS_MAGIC  = "REDIS";             // 5 bytes, offset 0
const BSON_MAGIC   = null;                // BSON has no reliable file magic

/** Check if the buffer starts with the given ASCII string */
function startsWithAscii(buf: Uint8Array, str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (buf[i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

/** Compare a sequence of bytes at an offset */
function matchBytes(buf: Uint8Array, offset: number, bytes: number[]): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

// ─── Text-based SQL dialect heuristics ───────────────────────────────────────

interface SqlAnalysis {
  isSql: boolean;
  dialect: SqlDialect;
  confidence: "high" | "medium" | "low";
}

function analyseSqlContent(text: string): SqlAnalysis {
  const upper = text.slice(0, 8192).toUpperCase();

  // PostgreSQL specific markers
  const pgMarkers = [
    "-- POSTGRESQL DATABASE DUMP",
    "-- DUMPED FROM DATABASE VERSION",     // pg_dump header
    "SET STANDARD_CONFORMING_STRINGS",
    "COPY PUBLIC.",
    "\\CONNECT ",
    "CREATE EXTENSION",
    "OWNER TO ",
    "SET SEARCH_PATH",
  ];

  // MySQL/MariaDB specific markers
  const mysqlMarkers = [
    "-- MYSQL DUMP",
    "-- HOST: ",
    "ENGINE=INNODB",
    "ENGINE=MYISAM",
    "AUTO_INCREMENT=",
    "DEFAULT CHARSET=",
    "ROW_FORMAT=",
    "SET NAMES ",
    "-- MARIADB DUMP",
  ];

  const pgScore = pgMarkers.filter((m) => upper.includes(m)).length;
  const mysqlScore = mysqlMarkers.filter((m) => upper.includes(m)).length;

  const hasSqlKeywords =
    upper.includes("CREATE TABLE") ||
    upper.includes("INSERT INTO") ||
    upper.includes("DROP TABLE") ||
    upper.includes("ALTER TABLE") ||
    upper.includes("SELECT ");

  if (!hasSqlKeywords) {
    return { isSql: false, dialect: "generic", confidence: "low" };
  }

  if (pgScore >= 2) {
    return { isSql: true, dialect: "postgresql", confidence: pgScore >= 4 ? "high" : "medium" };
  }
  if (mysqlScore >= 2) {
    return {
      isSql: true,
      dialect: upper.includes("MARIADB") ? "mariadb" : "mysql",
      confidence: mysqlScore >= 4 ? "high" : "medium",
    };
  }
  if (pgScore === 1) {
    return { isSql: true, dialect: "postgresql", confidence: "low" };
  }
  if (mysqlScore === 1) {
    return { isSql: true, dialect: "mysql", confidence: "low" };
  }

  return { isSql: true, dialect: "generic", confidence: "medium" };
}

// ─── Extension map ────────────────────────────────────────────────────────────

const EXTENSION_HINTS: Record<string, { format: DatabaseFormat; dialect?: SqlDialect }> = {
  sqlite:   { format: "sqlite" },
  sqlite3:  { format: "sqlite" },
  db:       { format: "sqlite" },     // common but ambiguous — confirmed by magic bytes
  db3:      { format: "sqlite" },
  sql:      { format: "sql_dump" },
  dump:     { format: "sql_dump" },
  bak:      { format: "sql_dump" },   // ambiguous, confirmed by content
  csv:      { format: "csv" },
  tsv:      { format: "csv" },
  mdb:      { format: "access" },
  accdb:    { format: "access" },
  bson:     { format: "mongodb_bson" },
  rdb:      { format: "redis_rdb" },
  duckdb:   { format: "duckdb" },
  fdb:      { format: "firebird" },
  gdb:      { format: "firebird" },
};

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

// ─── Public detection function ────────────────────────────────────────────────

export async function detectFormat(file: File): Promise<DetectionResult> {
  // Read first 64 bytes for magic byte detection
  const headerBuffer = await file.slice(0, 64).arrayBuffer();
  const header = new Uint8Array(headerBuffer);

  // ── SQLite ────────────────────────────────────────────────────────────────
  if (startsWithAscii(header, SQLITE_MAGIC)) {
    return {
      format:      "sqlite",
      confidence:  "high",
      supported:   true,
      displayName: "SQLite Database",
    };
  }

  // ── Redis RDB ─────────────────────────────────────────────────────────────
  if (startsWithAscii(header, REDIS_MAGIC)) {
    return {
      format:      "redis_rdb",
      confidence:  "high",
      supported:   false,
      displayName: "Redis Database (RDB)",
    };
  }

  // ── Microsoft Access (.mdb / .accdb) ─────────────────────────────────────
  // mdb: 00 01 00 00 53 74 61 6E 64 61 72 64 20 4A 65 74 (Standard Jet)
  if (matchBytes(header, 0, [0x00, 0x01, 0x00, 0x00]) && matchBytes(header, 4, [0x53, 0x74, 0x61, 0x6e])) {
    return {
      format:      "access",
      confidence:  "high",
      supported:   false,
      displayName: "Microsoft Access Database",
    };
  }
  // accdb: 00 01 00 00 53 74 61 6E 64 61 72 64 20 41 43 45 (Standard ACE)
  if (matchBytes(header, 0, [0x00, 0x01, 0x00, 0x00]) && matchBytes(header, 4, [0x53, 0x74, 0x61, 0x6e])) {
    return {
      format:      "access",
      confidence:  "high",
      supported:   false,
      displayName: "Microsoft Access Database",
    };
  }

  // ── DuckDB ────────────────────────────────────────────────────────────────
  // DuckDB magic: 44 55 43 4B (DUCK)
  if (matchBytes(header, 0, [0x44, 0x55, 0x43, 0x4b])) {
    return {
      format:      "duckdb",
      confidence:  "high",
      supported:   false,
      displayName: "DuckDB Database",
    };
  }

  // ── Firebird ──────────────────────────────────────────────────────────────
  // Firebird: first bytes include ODS version. Check header page magic.
  if (matchBytes(header, 24, [0x00, 0x00, 0x0c, 0x00])) {
    // possible Firebird — check ext too
    const ext = getExtension(file.name);
    if (ext === "fdb" || ext === "gdb") {
      return {
        format:      "firebird",
        confidence:  "medium",
        supported:   false,
        displayName: "Firebird Database",
      };
    }
  }

  // ── Text-based content analysis ───────────────────────────────────────────
  // Peek at first 8KB as text
  const textBuffer = await file.slice(0, 8192).arrayBuffer();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const textSample = decoder.decode(textBuffer);

  // ── CSV detection ─────────────────────────────────────────────────────────
  const ext = getExtension(file.name);
  if (ext === "csv" || ext === "tsv") {
    return {
      format:      "csv",
      confidence:  "high",
      supported:   true,
      displayName: "CSV File",
    };
  }

  // Check if it looks like CSV (mostly printable chars, comma-separated lines)
  if (looksLikeCsv(textSample)) {
    return {
      format:      "csv",
      confidence:  "medium",
      supported:   true,
      displayName: "CSV File",
    };
  }

  // ── SQL dump analysis ─────────────────────────────────────────────────────
  const sqlAnalysis = analyseSqlContent(textSample);

  if (sqlAnalysis.isSql) {
    const dialect = sqlAnalysis.dialect;
    const dialectNames: Record<SqlDialect, string> = {
      mysql:      "MySQL Database Dump",
      mariadb:    "MariaDB Database Dump",
      postgresql: "PostgreSQL Database Dump",
      mssql:      "SQL Server Database Dump",
      oracle:     "Oracle Database Dump",
      generic:    "SQL Database Dump",
    };
    return {
      format:      "sql_dump",
      dialect,
      confidence:  sqlAnalysis.confidence,
      supported:   true,
      displayName: dialectNames[dialect] ?? "SQL Database Dump",
    };
  }

  // ── Extension-based fallback ──────────────────────────────────────────────
  const extHint = EXTENSION_HINTS[ext];
  if (extHint) {
    const supported = extHint.format === "sqlite" || extHint.format === "sql_dump" || extHint.format === "csv";
    const formatNames: Record<DatabaseFormat, string> = {
      sqlite:       "SQLite Database",
      sql_dump:     "SQL Database Dump",
      csv:          "CSV File",
      access:       "Microsoft Access Database",
      mongodb_bson: "MongoDB / BSON",
      redis_rdb:    "Redis Database (RDB)",
      duckdb:       "DuckDB Database",
      firebird:     "Firebird Database",
      unknown:      "Unknown Format",
    };
    return {
      format:      extHint.format,
      dialect:     extHint.dialect,
      confidence:  "low",
      supported,
      displayName: formatNames[extHint.format],
    };
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  return {
    format:      "unknown",
    confidence:  "low",
    supported:   false,
    displayName: "Unknown or Unsupported Format",
  };
}

// ─── CSV heuristic ────────────────────────────────────────────────────────────

function looksLikeCsv(text: string): boolean {
  const lines = text.split("\n").slice(0, 10).filter(Boolean);
  if (lines.length < 2) return false;

  // Check consistent delimiter count across lines
  const delimiters = [",", "\t", ";", "|"];
  for (const d of delimiters) {
    const counts = lines.map((l) => (l.match(new RegExp("\\" + d, "g")) || []).length);
    if (counts[0] > 0 && counts.every((c) => c === counts[0])) return true;
  }
  return false;
}
