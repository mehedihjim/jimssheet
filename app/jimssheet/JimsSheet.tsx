"use client";

import React, { useCallback, useState } from "react";
import UploadZone from "./UploadZone";
import AnalysisView from "./AnalysisView";
import TableSelector from "./TableSelector";
import TablePreview from "./TablePreview";
import ExportSuccess from "./ExportSuccess";
import ErrorView from "./ErrorView";
import { detectFormat } from "./detector/formatDetector";
import { sqliteParser } from "./parsers/sqliteParser";
import { sqlDumpParser } from "./parsers/sqlDumpParser";
import { csvParser } from "./parsers/csvParser";
import { generateExcel } from "./excel/excelGenerator";
import type { ParsedDatabase, ParsedTable, ParseErrorKind } from "./parsers/types";
import { ParseError } from "./parsers/types";
import type { DetectionResult } from "./parsers/types";

// ─── Parsers registry ─────────────────────────────────────────────────────────
const PARSERS = [sqliteParser, sqlDumpParser, csvParser];

// ─── State machine stages ─────────────────────────────────────────────────────
type Stage =
  | { kind: "idle" }
  | { kind: "analyzing"; steps: AnalysisStep[]; file: File }
  | { kind: "analyzed"; db: ParsedDatabase; file: File; detection: DetectionResult }
  | { kind: "generating" }
  | { kind: "done"; filename: string; sheetCount: number; totalRows: number; buffer: ArrayBuffer }
  | { kind: "error"; errorKind: ParseErrorKind; message: string; details?: string };

interface AnalysisStep {
  label: string;
  done: boolean;
  active: boolean;
}

function makeSteps(labels: string[]): AnalysisStep[] {
  return labels.map((label, i) => ({ label, done: false, active: i === 0 }));
}

// ─── Unsupported format error messages ───────────────────────────────────────

function getUnsupportedMessage(detection: DetectionResult): string {
  const names: Record<string, string> = {
    access:       "Microsoft Access",
    mongodb_bson: "MongoDB / BSON",
    redis_rdb:    "Redis RDB",
    duckdb:       "DuckDB",
    firebird:     "Firebird",
    unknown:      "unknown",
  };
  const name = names[detection.format] ?? detection.displayName;
  if (detection.format === "unknown") {
    return "We couldn't identify this database format.";
  }
  return `We recognized this file as ${name}, but this format isn't currently supported.`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function JimsSheet() {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewTable, setPreviewTable] = useState<ParsedTable | null>(null);

  // ── Reset to idle ──────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setStage({ kind: "idle" });
    setSelected(new Set());
    setPreviewTable(null);
  }, []);

  // ── Handle file upload ────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    const STEP_LABELS = [
      "Analyzing file…",
      "Detecting database format…",
      "Reading database structure…",
      "Finding tables…",
      "Preparing preview…",
    ];

    const steps = makeSteps(STEP_LABELS);
    setStage({ kind: "analyzing", steps: [...steps], file });

    const advanceStep = (doneIdx: number, activeIdx: number, updatedSteps: AnalysisStep[]) => {
      updatedSteps[doneIdx].done   = true;
      updatedSteps[doneIdx].active = false;
      if (activeIdx < updatedSteps.length) {
        updatedSteps[activeIdx].active = true;
      }
      setStage((prev) =>
        prev.kind === "analyzing" ? { ...prev, steps: [...updatedSteps] } : prev
      );
    };

    try {
      // Step 0 → 1: Detect format
      await delay(200);
      advanceStep(0, 1, steps);

      const detection = await detectFormat(file);

      // Step 1 → 2
      await delay(300);
      advanceStep(1, 2, steps);

      // Check if supported
      if (!detection.supported) {
        steps[2].done   = false;
        steps[2].active = false;
        setStage({
          kind:      "error",
          errorKind: "unsupported",
          message:   getUnsupportedMessage(detection),
          details:   detection.format !== "unknown"
            ? "Support for this format may be added in a future version."
            : undefined,
        });
        return;
      }

      // Find parser
      const parser = PARSERS.find((p) => p.canHandle(detection));
      if (!parser) {
        setStage({
          kind:      "error",
          errorKind: "unsupported",
          message:   `We recognized this file as ${detection.displayName}, but parsing is not yet implemented.`,
        });
        return;
      }

      // Step 2 → 3: Parse
      let db: ParsedDatabase;
      let progressStepIdx = 2;

      const onProgress = (msg: string) => {
        // Map parser progress messages to step transitions
        if (msg.includes("structure") || msg.includes("Analyzing")) {
          if (progressStepIdx < 2) { advanceStep(progressStepIdx, 2, steps); progressStepIdx = 2; }
        } else if (msg.includes("table") || msg.includes("Finding")) {
          if (progressStepIdx < 3) { advanceStep(progressStepIdx, 3, steps); progressStepIdx = 3; }
        }
        // Update the active step label
        setStage((prev) => {
          if (prev.kind !== "analyzing") return prev;
          const updated = [...prev.steps];
          const activeIdx = updated.findIndex((s) => s.active);
          if (activeIdx >= 0) updated[activeIdx] = { ...updated[activeIdx], label: msg };
          return { ...prev, steps: updated };
        });
      };

      db = await parser.parse(file, detection, onProgress);

      // Step 3 → 4: Done
      advanceStep(3, 4, steps);
      await delay(200);
      advanceStep(4, 5, steps);
      await delay(200);

      // Select all tables by default
      const allNames = new Set(db.tables.map((t) => t.name));
      setSelected(allNames);
      setPreviewTable(null);
      setStage({ kind: "analyzed", db, file, detection });
    } catch (err) {
      if (err instanceof ParseError) {
        setStage({
          kind:      "error",
          errorKind: err.kind,
          message:   err.message,
          details:   err.details,
        });
      } else {
        setStage({
          kind:      "error",
          errorKind: "corrupted",
          message:   "Something went wrong while processing the file.",
          details:   "The file may be damaged, incomplete, or in an unexpected format.",
        });
      }
    }
  }, []);

  // ── Table selection ────────────────────────────────────────────────────────
  const toggleTable = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (stage.kind !== "analyzed") return;
    setSelected(new Set(stage.db.tables.map((t) => t.name)));
  }, [stage]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handlePreview = useCallback((table: ParsedTable | null) => {
    setPreviewTable(table);
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (stage.kind !== "analyzed") return;
    if (selected.size === 0) return;

    const tablesToExport = stage.db.tables.filter((t) => selected.has(t.name));
    setStage({ kind: "generating" });

    try {
      // Run synchronously but yield to UI first
      await delay(100);
      const result = generateExcel(stage.db, tablesToExport, stage.file.name);
      setStage({
        kind:       "done",
        filename:   result.filename,
        sheetCount: result.sheetCount,
        totalRows:  result.totalRows,
        buffer:     result.buffer,
      });
    } catch {
      setStage({
        kind:      "error",
        errorKind: "corrupted",
        message:   "Failed to generate the Excel file.",
        details:   "An unexpected error occurred during export.",
      });
    }
  }, [stage, selected]);

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (stage.kind !== "done") return;
    const blob = new Blob([stage.buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = stage.filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [stage]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="jimssheet-root">
      {/* Header */}
      <header className="app-header" role="banner">
        <div className="app-header-inner">
          <a href="/" className="app-logo" aria-label="JimsSheet — home">
            <span className="app-logo-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694 4.125-8.25 4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
              </svg>
            </span>
            <span className="app-logo-text">JimsSheet</span>
          </a>
        </div>
      </header>

      {/* Main content */}
      <main className="app-main" id="main-content">
        {stage.kind === "idle" && (
          <UploadZone onFile={handleFile} />
        )}

        {stage.kind === "analyzing" && (
          <AnalysisView
            steps={stage.steps}
            filename={stage.file.name}
            fileSize={stage.file.size}
          />
        )}

        {stage.kind === "analyzed" && (
          <div className="analyzed-layout">
            <TableSelector
              tables={stage.db.tables}
              selected={selected}
              onToggle={toggleTable}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              onPreview={handlePreview}
              previewTable={previewTable}
              dbType={stage.db.metadata.displayName}
              filename={stage.file.name}
              fileSize={stage.file.size}
            />

            {previewTable && (
              <TablePreview table={previewTable} />
            )}

            {/* Export bar */}
            <div className="export-bar">
              <div className="export-bar-info">
                <span className="export-count">
                  {selected.size} table{selected.size !== 1 ? "s" : ""} selected
                </span>
                <span className="export-bar-sep">·</span>
                <span className="export-row-count">
                  {stage.db.tables
                    .filter((t) => selected.has(t.name))
                    .reduce((n, t) => n + t.totalRows, 0)
                    .toLocaleString()} rows
                </span>
              </div>
              <div className="export-bar-actions">
                <button
                  className="btn-ghost"
                  onClick={reset}
                  aria-label="Start over with a different file"
                >
                  Start over
                </button>
                <button
                  id="generate-excel-btn"
                  className="btn-primary"
                  onClick={handleExport}
                  disabled={selected.size === 0}
                  aria-label="Generate Excel workbook"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m2.25-3.75h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125m1.125-1.125c.621 0 1.125.504 1.125 1.125m0 1.5v-1.5m0 0c0 .621.504 1.125 1.125 1.125m0 0h-1.5" />
                  </svg>
                  Generate Excel
                </button>
              </div>
            </div>
          </div>
        )}

        {stage.kind === "generating" && (
          <div className="generating-view" role="status" aria-live="polite">
            <div className="generating-card">
              <div className="generating-spinner" aria-hidden="true" />
              <div className="generating-text">Generating your Excel workbook…</div>
              <div className="generating-subtext">This may take a moment for large databases.</div>
            </div>
          </div>
        )}

        {stage.kind === "done" && (
          <ExportSuccess
            filename={stage.filename}
            sheetCount={stage.sheetCount}
            totalRows={stage.totalRows}
            onDownload={handleDownload}
            onReset={reset}
          />
        )}

        {stage.kind === "error" && (
          <ErrorView
            kind={stage.errorKind}
            message={stage.message}
            details={stage.details}
            onReset={reset}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer" role="contentinfo">
        <p className="app-footer-text">
          JimsSheet — Drop a database. Get a spreadsheet. &nbsp;·&nbsp; All processing happens in your browser.
        </p>
      </footer>
    </div>
  );
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
