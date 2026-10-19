/**
 * sidebar.ts — sidebar data definitions (testable, no JSX).
 *
 * The React component lives in sidebar.tsx; this file exports only
 * data so node:test can import it without TSX parsing.
 */

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
