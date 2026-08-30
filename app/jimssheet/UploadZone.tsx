"use client";

import React, { useCallback, useRef, useState } from "react";

interface UploadZoneProps {
  onFile: (file: File) => void;
}

const ACCEPTED_EXTENSIONS = [
  ".sqlite", ".sqlite3", ".db", ".db3",
  ".sql", ".dump", ".bak",
  ".csv", ".tsv",
  ".mdb", ".accdb",
  ".bson", ".rdb",
  ".duckdb", ".fdb", ".gdb",
];

export default function UploadZone({ onFile }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (file) onFile(file);
    },
    [onFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset input so same file can be re-uploaded
      e.target.value = "";
    },
    [handleFile]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inputRef.current?.click();
      }
    },
    []
  );

  return (
    <div className="upload-section">
      {/* Hero text */}
      <div className="hero-text">
        <h1 className="hero-title">
          Drop a database.<br />Get a spreadsheet.
        </h1>
        <p className="hero-subtitle">
          Upload any database file — SQLite, MySQL dump, PostgreSQL dump, CSV, and more.<br />
          JimsSheet detects the format automatically and converts it to a formatted Excel workbook.
        </p>
      </div>

      {/* Upload zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload database file — click or drag and drop"
        className={`upload-zone${isDragging ? " upload-zone--dragging" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          type="file"
          id="file-upload-input"
          aria-label="Select database file"
          className="sr-only"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={onInputChange}
        />

        <div className="upload-icon-wrapper">
          <svg
            className="upload-icon"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
            />
          </svg>
        </div>

        <div className="upload-cta">
          <span className="upload-cta-primary">
            {isDragging ? "Drop it!" : "Drop your database here"}
          </span>
          <span className="upload-cta-secondary">
            or <span className="upload-browse-link">browse to select a file</span>
          </span>
        </div>

        <div className="upload-formats">
          SQLite · MySQL dump · PostgreSQL dump · CSV · and more
        </div>
      </div>

      {/* Privacy badge */}
      <div className="privacy-badge" role="note">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
            clipRule="evenodd"
          />
        </svg>
        Your files are processed entirely in your browser. Nothing is uploaded to any server.
      </div>
    </div>
  );
}
