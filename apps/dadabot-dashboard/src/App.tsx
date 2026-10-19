/**
 * App.tsx — router entry point.
 *
 * Standalone mode: /inbox, /canvas, /safety.
 * Drop-in mode for muhanai: import { InboxPage } from "./pages/InboxPage"
 * and add to muhanai's existing route table.
 */
import * as React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { InboxPage } from "./pages/InboxPage";
import { BlockCanvasPage } from "./pages/BlockCanvasPage";
import { SafetyPipelinePage } from "./pages/SafetyPipelinePage";

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/canvas" element={<BlockCanvasPage />} />
        <Route path="/safety" element={<SafetyPipelinePage />} />
      </Routes>
    </BrowserRouter>
  );
}
