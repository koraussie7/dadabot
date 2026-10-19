/**
 * App.tsx — router entry point.
 *
 * Standalone mode: /inbox, /canvas, /safety.
 * Drop-in mode for muhanai: import { InboxPage } from "./pages/InboxPage"
 * and add to muhanai's existing route table.
 */
import * as React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { InboxPage } from "./pages/InboxPage.tsx";
import { BlockCanvasPage } from "./pages/BlockCanvasPage.tsx";
import { SafetyPipelinePage } from "./pages/SafetyPipelinePage.tsx";
import { LandingPage } from "./pages/LandingPage.tsx";
export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dadabot" replace />} />
        <Route path="/dadabot" element={<LandingPage />} />
        <Route path="/dadabot/setup" element={<LandingPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/canvas" element={<BlockCanvasPage />} />
        <Route path="/safety" element={<SafetyPipelinePage />} />
      </Routes>
    </BrowserRouter>
  );
}
