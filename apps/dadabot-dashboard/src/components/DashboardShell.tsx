/**
 * DashboardShell.tsx — wraps page content with the sidebar layout.
 *
 * Renders sidebar + main content. In a real muhanai integration, this is
 * replaced by muhanai's existing DashboardLayout; only the children need
 * to slot into muhanai's router.
 */
import * as React from "react";
import { DashboardSidebar } from "../lib/sidebar";
import "../lib/dashboard.css";

export interface DashboardShellProps {
  children: React.ReactNode;
  activePath: string;
  pendingCount?: number;
}

export function DashboardShell({
  children,
  pendingCount,
}: DashboardShellProps): React.ReactElement {
  return (
    <div className="ddb-layout">
      <DashboardSidebar pendingCount={pendingCount} />
      <main className="ddb-main">{children}</main>
    </div>
  );
}
