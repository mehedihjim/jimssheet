"use client";

import React from "react";

interface ExportSuccessProps {
  filename: string;
  sheetCount: number;
  totalRows: number;
  onDownload: () => void;
  onReset: () => void;
}

export default function ExportSuccess({
  filename,
  sheetCount,
  totalRows,
  onDownload,
  onReset,
}: ExportSuccessProps) {
  return (
    <div className="success-view">
      <div className="success-card">
        {/* Checkmark icon */}
        <div className="success-icon-wrapper" aria-hidden="true">
          <div className="success-icon-ring">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="success-checkmark"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        <h2 className="success-title">Your spreadsheet is ready.</h2>
        <p className="success-subtitle">
          Successfully converted your database to Excel format.
        </p>

        {/* Stats */}
        <div className="success-stats">
          <div className="success-stat">
            <div className="success-stat-value">{filename}</div>
            <div className="success-stat-label">File name</div>
          </div>
          <div className="success-stat-divider" aria-hidden="true" />
          <div className="success-stat">
            <div className="success-stat-value">{sheetCount}</div>
            <div className="success-stat-label">Sheet{sheetCount !== 1 ? "s" : ""}</div>
          </div>
          <div className="success-stat-divider" aria-hidden="true" />
          <div className="success-stat">
            <div className="success-stat-value">{totalRows.toLocaleString()}</div>
            <div className="success-stat-label">Row{totalRows !== 1 ? "s" : ""} exported</div>
          </div>
        </div>

        {/* Actions */}
        <div className="success-actions">
          <button
            id="download-excel-btn"
            className="btn-primary"
            onClick={onDownload}
            aria-label={`Download ${filename}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download Excel
          </button>
          <button
            id="convert-another-btn"
            className="btn-secondary"
            onClick={onReset}
            aria-label="Convert another file"
          >
            Convert another file
          </button>
        </div>
      </div>
    </div>
  );
}
