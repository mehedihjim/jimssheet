"use client";

import React from "react";
import type { ParsedTable } from "./parsers/types";

interface TableSelectorProps {
  tables: ParsedTable[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onPreview: (table: ParsedTable) => void;
  previewTable: ParsedTable | null;
  dbType: string;
  filename: string;
  fileSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatRows(n: number): string {
  return n.toLocaleString();
}

export default function TableSelector({
  tables,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onPreview,
  previewTable,
  dbType,
  filename,
  fileSize,
}: TableSelectorProps) {
  const allSelected = selected.size === tables.length;

  return (
    <div className="table-selector">
      {/* Database info banner */}
      <div className="db-info-banner">
        <div className="db-info-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694 4.125-8.25 4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
        </div>
        <div className="db-info-details">
          <div className="db-info-type">{dbType}</div>
          <div className="db-info-meta">
            <span>{filename}</span>
            <span className="db-info-sep">·</span>
            <span>{formatBytes(fileSize)}</span>
            <span className="db-info-sep">·</span>
            <span>{tables.length} table{tables.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>

      {/* Selection controls */}
      <div className="selector-controls">
        <h2 className="selector-heading">
          Select tables to export
          <span className="selector-count">
            {selected.size} / {tables.length} selected
          </span>
        </h2>
        <div className="selector-bulk-buttons">
          <button
            className="btn-ghost btn-sm"
            onClick={onSelectAll}
            disabled={allSelected}
            aria-label="Select all tables"
          >
            Select all
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={onDeselectAll}
            disabled={selected.size === 0}
            aria-label="Deselect all tables"
          >
            Deselect all
          </button>
        </div>
      </div>

      {/* Table list */}
      <ul className="table-list" role="list" aria-label="Database tables">
        {tables.map((table) => {
          const isSelected = selected.has(table.name);
          const isPreviewing = previewTable?.name === table.name;

          return (
            <li key={table.name} className={`table-item${isSelected ? " table-item--selected" : ""}`}>
              <label className="table-item-label">
                <input
                  type="checkbox"
                  className="table-checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(table.name)}
                  aria-label={`Select table ${table.name}`}
                />
                <div className="table-item-info">
                  <span className="table-name">{table.name}</span>
                  <span className="table-meta">
                    {formatRows(table.totalRows)} row{table.totalRows !== 1 ? "s" : ""}
                    <span className="table-sep">·</span>
                    {table.columns.length} column{table.columns.length !== 1 ? "s" : ""}
                    {table.truncated && (
                      <span className="table-truncated-badge" title="Data capped at 100,000 rows">
                        · capped
                      </span>
                    )}
                  </span>
                </div>
              </label>
              <button
                className={`btn-preview${isPreviewing ? " btn-preview--active" : ""}`}
                onClick={() => onPreview(isPreviewing ? (null as unknown as ParsedTable) : table)}
                aria-label={isPreviewing ? `Close preview for ${table.name}` : `Preview table ${table.name}`}
                aria-pressed={isPreviewing}
              >
                {isPreviewing ? "Close" : "Preview"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
