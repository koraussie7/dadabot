import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DashboardShell } from "./components/DashboardShell";
import { LandingSequence } from "./components/landing/LandingSequence";

// Lazy-loaded pages
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const FindPage = lazy(() => import("./pages/FindPage"));
const AgentCastPage = lazy(() => import("./pages/AgentCastPage"));
const AgentMeshPage = lazy(() => import("./pages/AgentMeshPage"));
const DesktopPage = lazy(() => import("./pages/DesktopPage"));
const BitterbotPage = lazy(() => import("./pages/BitterbotPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const HumanAgentsPage = lazy(() => import("./pages/HumanAgentsPage"));
const P2PNetworkPage = lazy(() => import("./pages/P2PNetworkPage"));
const NetworkMonitorPage = lazy(() => import("./pages/NetworkMonitorPage"));
const HorizonGlassesPage = lazy(() => import("./pages/HorizonGlassesPage"));
const GlassesDevicesPage = lazy(() => import("./pages/GlassesDevicesPage"));
const ModelsPage = lazy(() => import("./pages/ModelsPage"));
const ComputeMeshPage = lazy(() => import("./pages/ComputeMeshPage"));
const MCPSkillsPage = lazy(() => import("./pages/MCPSkillsPage"));
const HivebearPage = lazy(() => import("./pages/HivebearPage"));
const KnowledgePage = lazy(() => import("./pages/KnowledgePage"));
const VerificationPage = lazy(() => import("./pages/VerificationPage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const SemanticVotePage = lazy(() => import("./pages/SemanticVotePage"));
const FederationPage = lazy(() => import("./pages/FederationPage"));
const OntologyPage = lazy(() => import("./pages/OntologyPage"));
const AgentsMarketPage = lazy(() => import("./pages/AgentsMarketPage"));
const HumanExpertsPage = lazy(() => import("./pages/HumanExpertsPage"));
const ComputeMarketPage = lazy(() => import("./pages/ComputeMarketPage"));
const MCPMarketPage = lazy(() => import("./pages/MCPMarketPage"));
const KnowledgeMarketPage = lazy(() => import("./pages/KnowledgeMarketPage"));
const TokenBankPage = lazy(() => import("./pages/TokenBankPage"));
const ContributionsPage = lazy(() => import("./pages/ContributionsPage"));
const ReputationPage = lazy(() => import("./pages/ReputationPage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const TasksPage = lazy(() => import("./pages/TasksPage"));
const WorkflowsPage = lazy(() => import("./pages/WorkflowsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const HappyPage = lazy(() => import("./pages/HappyPage"));
const PythiaPage = lazy(() => import("./pages/PythiaPage"));
const WorldPage = lazy(() => import("./pages/WorldPage"));
const GlassesAppPage = lazy(() => import("./pages/GlassesAppPage"));
const GhostPage = lazy(() => import("./pages/GhostPage"));

// NEW: Minima pages
const MinimaWalletPage = lazy(() => import("./components/minima/MinimaWalletPage"));
const MinimaAnchorPage = lazy(() => import("./components/minima/MinimaAnchorPage"));
const MinimaNodeStatusPage = lazy(() => import("./components/minima/MinimaNodeStatus"));
const AgentMemoryPage = lazy(() => import("./components/minima/AgentMemoryPage"));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LandingSequence />}>
        <DashboardShell>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/" element={<FindPage />} />
            <Route path="/agent-cast" element={<AgentCastPage />} />
            <Route path="/agent-mesh" element={<AgentMeshPage />} />
            <Route path="/desktop" element={<DesktopPage />} />
            <Route path="/bitterbot" element={<BitterbotPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/human-agents" element={<HumanAgentsPage />} />
            <Route path="/network" element={<P2PNetworkPage />} />
            <Route path="/monitor" element={<NetworkMonitorPage />} />
            <Route path="/horizon-glasses" element={<HorizonGlassesPage />} />
            <Route path="/glasses-devices" element={<GlassesDevicesPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/compute-mesh" element={<ComputeMeshPage />} />
            <Route path="/mcp-skills" element={<MCPSkillsPage />} />
            <Route path="/hivebear" element={<HivebearPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/verification" element={<VerificationPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/semantic-vote" element={<SemanticVotePage />} />
            <Route path="/federation" element={<FederationPage />} />
            <Route path="/ontology" element={<OntologyPage />} />
            <Route path="/marketplace/agents" element={<AgentsMarketPage />} />
            <Route path="/marketplace/human-experts" element={<HumanExpertsPage />} />
            <Route path="/marketplace/compute" element={<ComputeMarketPage />} />
            <Route path="/marketplace/mcp" element={<MCPMarketPage />} />
            <Route path="/marketplace/knowledge" element={<KnowledgeMarketPage />} />
            <Route path="/token-bank" element={<TokenBankPage />} />
            <Route path="/contributions" element={<ContributionsPage />} />
            <Route path="/reputation" element={<ReputationPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/happy" element={<HappyPage />} />
            <Route path="/pythia" element={<PythiaPage />} />
            <Route path="/world" element={<WorldPage />} />
            <Route path="/glasses-app" element={<GlassesAppPage />} />
            <Route path="/ghost" element={<GhostPage />} />

            {/* Minima Pages */}
            <Route path="/minima-wallet" element={<MinimaWalletPage />} />
            <Route path="/minima-anchor" element={<MinimaAnchorPage />} />
            <Route path="/agent-memory" element={<AgentMemoryPage />} />
            <Route path="/minima-node-status" element={<MinimaNodeStatusPage />} />
          </Routes>
        </Suspense>
      </DashboardShell>
    </BrowserRouter>
  );
}

export default App;