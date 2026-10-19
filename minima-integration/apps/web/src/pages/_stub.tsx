/**
 * Stub page template for missing muhanai pages.
 * Real muhanai app has these — minima-integration only needs them
 * to compile for typecheck + tsc. Replace with real components later.
 */
import React from "react";

export interface StubPageProps {
  title: string;
  subtitle?: string;
}

export function StubPage({
  title,
  subtitle,
}: StubPageProps): React.ReactElement {
  return (
    <div style={{ padding: 32, color: "var(--fg, #f1f5f9)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>
        {title}
      </h1>
      {subtitle && (
        <p style={{ color: "var(--meta, #94a3b8)", fontSize: 13, margin: 0 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

export default StubPage;
