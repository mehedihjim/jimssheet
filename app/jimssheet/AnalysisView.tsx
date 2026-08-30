"use client";

import React from "react";

interface AnalysisViewProps {
  steps: { label: string; done: boolean; active: boolean }[];
  filename: string;
  fileSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function AnalysisView({ steps, filename, fileSize }: AnalysisViewProps) {
  return (
    <div className="analysis-view">
      <div className="analysis-card">
        <div className="analysis-file-info">
          <div className="analysis-file-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
            </svg>
          </div>
          <div>
            <div className="analysis-filename">{filename}</div>
            <div className="analysis-filesize">{formatBytes(fileSize)}</div>
          </div>
        </div>

        <div className="analysis-steps" role="status" aria-live="polite" aria-label="Analysis progress">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`analysis-step${step.active ? " analysis-step--active" : ""}${step.done ? " analysis-step--done" : ""}`}
            >
              <div className="analysis-step-indicator" aria-hidden="true">
                {step.done ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                ) : step.active ? (
                  <span className="spinner" />
                ) : (
                  <span className="step-dot" />
                )}
              </div>
              <span className="analysis-step-label">{step.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
