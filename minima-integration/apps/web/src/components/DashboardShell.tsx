/**
 * DashboardShell.tsx — Layout wrapper for app pages.
 * Real muhanai app has its own; this is a minima-integration stub.
 */
import React from "react";

export interface DashboardShellProps {
  children: React.ReactNode;
}

export function DashboardShell({
  children,
}: DashboardShellProps): React.ReactElement {
  return (
    <div
      style={{ minHeight: "100vh", background: "#0a0a0a", color: "#f1f5f9" }}
    >
      <main>{children}</main>
    </div>
  );
}

export default DashboardShell;
