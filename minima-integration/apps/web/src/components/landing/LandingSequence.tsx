/**
 * LandingSequence.tsx — Loading fallback for lazy routes.
 */
import React from "react";

export function LandingSequence(): React.ReactElement {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        color: "#94a3b8",
        fontSize: 13,
        fontFamily: "SF Mono, Menlo, monospace",
      }}
    >
      Loading…
    </div>
  );
}

export default LandingSequence;
