// ─────────────────────────────────────────────────────────────────────────────
// JimsSheet — Normalized Database Representation
// All parsers produce this common structure so the rest of the app is
// format-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

export type CellValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

export interface ColumnInfo {
  name: string;
  /** The raw type string from the source (e.g. "VARCHAR(255)", "INTEGER") */
  rawType: string;
  /** Normalised type bucket used for Excel formatting */
  type: "text" | "integer" | "decimal" | "boolean" | "date" | "datetime" | "blob" | "unknown";
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface ForeignKeyInfo {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface ParsedTable {
  name: string;
  columns: ColumnInfo[];
  /** Rows as parallel arrays to columns */
  rows: CellValue[][];
  /** Total rows in the source (may exceed rows.length if capped) */
  totalRows: number;
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
  /** Whether data was truncated during parsing (e.g. memory limits) */
  truncated: boolean;
}

export interface DatabaseMetadata {
  /** Human-readable label shown in UI */
  displayName: string;
  /** Internal format key */
  format: DatabaseFormat;
  /** SQL dialect sub-type when applicable */
  dialect?: SqlDialect;
  /** Whether the parser can actually extract data */
  supported: boolean;
  /** Additional notes to display to the user */
  notes?: string;
}

export interface ParsedDatabase {
  tables: ParsedTable[];
  metadata: DatabaseMetadata;
}

// ─── Enums ────────────────────────────────────────────────────────────────────

export type DatabaseFormat =
  | "sqlite"
  | "sql_dump"
  | "csv"
  | "access"
  | "mongodb_bson"
  | "redis_rdb"
  | "duckdb"
  | "firebird"
  | "unknown";

export type SqlDialect =
  | "mysql"
  | "mariadb"
  | "postgresql"
  | "mssql"
  | "oracle"
  | "generic";

// ─── Detection result ─────────────────────────────────────────────────────────

export interface DetectionResult {
  format: DatabaseFormat;
  confidence: "high" | "medium" | "low";
  dialect?: SqlDialect;
  supported: boolean;
  displayName: string;
}

// ─── Parser errors ────────────────────────────────────────────────────────────

export type ParseErrorKind =
  | "unsupported"
  | "corrupted"
  | "empty"
  | "unknown"
  | "memory"
  | "partial";

export class ParseError extends Error {
  constructor(
    public readonly kind: ParseErrorKind,
    message: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = "ParseError";
  }
}

// ─── Parser interface ─────────────────────────────────────────────────────────

export interface DatabaseParser {
  /** Returns true if this parser can handle the detected format */
  canHandle(detection: DetectionResult): boolean;
  /** Parse the file and return a normalised database */
  parse(file: File, detection: DetectionResult, onProgress?: (msg: string) => void): Promise<ParsedDatabase>;
}

// ─── Column type normalisation ────────────────────────────────────────────────

export function normaliseColumnType(rawType: string): ColumnInfo["type"] {
  const t = rawType.toUpperCase().trim();
  if (/^(BOOL|BOOLEAN|TINYINT\(1\))/.test(t)) return "boolean";
  if (/^(DATE)$/.test(t)) return "date";
  if (/^(DATETIME|TIMESTAMP|TIMESTAMPTZ|TIMESTAMP WITH TIME ZONE)/.test(t)) return "datetime";
  if (/^(INT|INTEGER|BIGINT|SMALLINT|MEDIUMINT|TINYINT|SERIAL|BIGSERIAL|SMALLSERIAL)/.test(t)) return "integer";
  if (/^(FLOAT|DOUBLE|REAL|NUMERIC|DECIMAL|MONEY|SMALLMONEY|NUMBER)/.test(t)) return "decimal";
  if (/^(BLOB|BYTEA|BINARY|VARBINARY|IMAGE|LONGBLOB|MEDIUMBLOB|TINYBLOB)/.test(t)) return "blob";
  if (/^(VARCHAR|CHAR|TEXT|NCHAR|NVARCHAR|NTEXT|CLOB|LONGTEXT|MEDIUMTEXT|TINYTEXT|STRING)/.test(t)) return "text";
  return "unknown";
}
