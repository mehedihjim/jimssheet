"use client";

import React, { useMemo, useState } from "react";
import type { ParsedTable, CellValue } from "./parsers/types";

interface TablePreviewProps {
  table: ParsedTable;
}

const PAGE_SIZE = 100;

function formatCell(val: CellValue): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (val instanceof Date) return val.toISOString().replace("T", " ").slice(0, 19);
  return String(val);
}

function getCellClass(val: CellValue): string {
  if (val === null || val === undefined) return "cell cell--null";
  if (typeof val === "boolean") return "cell cell--bool";
  if (typeof val === "number" || val instanceof Date) return "cell cell--number";
  return "cell";
}

export default function TablePreview({ table }: TablePreviewProps) {
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(table.rows.length / PAGE_SIZE);
  const pageRows = useMemo(
    () => table.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [table.rows, page]
  );

  const start = page * PAGE_SIZE + 1;
  const end   = Math.min((page + 1) * PAGE_SIZE, table.rows.length);

  return (
    <div className="table-preview">
      <div className="preview-header">
        <h3 className="preview-title">{table.name}</h3>
        <div className="preview-row-info" aria-live="polite">
          Showing {start}–{end} of {table.totalRows.toLocaleString()} row{table.totalRows !== 1 ? "s" : ""}
          {table.truncated && (
            <span className="preview-truncated-note"> (preview capped at 100,000 rows)</span>
          )}
        </div>
      </div>

      <div className="preview-scroll-wrapper" tabIndex={0} aria-label={`Data preview for table ${table.name}`}>
        <table className="preview-table" role="grid">
          <thead>
            <tr>
              {table.columns.map((col) => (
                <th key={col.name} className="preview-th" scope="col" title={col.rawType}>
                  <div className="preview-th-inner">
                    <span className="preview-col-name">{col.name}</span>
                    <span className="preview-col-type">{col.type}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={table.columns.length}
                  className="preview-empty"
                >
                  No data in this table
                </td>
              </tr>
            ) : (
              pageRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "preview-row" : "preview-row preview-row--alt"}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={getCellClass(cell)}
                      title={cell === null || cell === undefined ? "NULL" : undefined}
                    >
                      {cell === null || cell === undefined ? (
                        <span className="null-badge">NULL</span>
                      ) : (
                        formatCell(cell)
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="preview-pagination" role="navigation" aria-label="Table pagination">
          <button
            className="btn-ghost btn-sm"
            onClick={() => setPage(0)}
            disabled={page === 0}
            aria-label="First page"
          >
            «
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="preview-page-info">
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="btn-ghost btn-sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            aria-label="Next page"
          >
            ›
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => setPage(totalPages - 1)}
            disabled={page === totalPages - 1}
            aria-label="Last page"
          >
            »
          </button>
        </div>
      )}
    </div>
  );
}
