유/**
 * sidebar.tsx — Dadabot sidebar definitions.
 *
 * Designed to drop into muhanai's Sidebar.tsx as additional entries,
 * or render standalone via <DashboardSidebar />.
 */
import * as React from "react";
import { Link } from "react-router-dom";

export interface SidebarEntry {
  path: string;
  label: string;
  icon: string;
  badge?: string | number;
}

export const DADABOT_SIDEBAR: SidebarEntry[] = [
  { path: "/inbox",  label: "Inbox",        icon: "🔒", badge: "pending" },
  { path: "/canvas", label: "Block Canvas", icon: "🧱" },
  { path: "/safety", label: "Safety",       icon: "🛡️" },
  { path: "/agents", label: "Free Models",  icon: "🤖", badge: "44" },
  { path: "/install",label: "Install",      icon: "📦" },
];

export function DashboardSidebar({
  pendingCount,
}: {
  pendingCount?: number;
}): React.ReactElement {
  const entries: SidebarEntry[] = DADABOT_SIDEBAR.map((e) =>
    e.path === "/inbox" && pendingCount !== undefined
      ? { ...e, badge: pendingCount }
      : e,
  );
  return (
    <nav className="ddb-sidebar" aria-label="Dadabot dashboard">
      <header className="ddb-sidebar__header">🌌 Dadabot</header>
      <ul className="ddb-sidebar__list">
        {entries.map((e) => (
          <li key={e.path}>
            <Link to={e.path} className="ddb-sidebar__link">
              <span className="ddb-sidebar__icon" aria-hidden="true">{e.icon}</span>
              <span className="ddb-sidebar__label">{e.label}</span>
              {e.badge !== undefined && (
                <span className="ddb-sidebar__badge">{e.badge}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
