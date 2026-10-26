/**
 * Dadabot Cindy Integration Layer - Basic Types and Configuration
 * 
 * Integrates Cindy's AI agent capabilities into Dadabot,
 * making Dadabot the main platform that absorbs all Cindy functionality
 * while maintaining Dadabot's local-first philosophy.
 */

export interface IntegrationConfig {
  cindyMode: "full" | "partial" | "off";
  preserveCindyMemory: boolean;
  enableHarnessSwitching: boolean;
  skillSharing: "dadabot-hub" | "cindy-marketplace" | "both";
  localFirstPriority: boolean;
  modelRouting: "auto" | "plan" | "agent";
  crossPlatformSync: "none" | "dropbox" | "github" | "custom";
}

export interface CindyHarness {
  name: string;
  type: "coding" | "general";
  status: "available" | "unavailable" | "error";
  capabilities: string[];
}

export interface CindySkill {
  id: string;
  name: string;
  description: string;
  category: "coding" | "research" | "writing" | "automation" | "data";
  complexity: "beginner" | "intermediate" | "advanced";
  setupRequired: boolean;
  params: Record<string, any>;
}

export interface IntegratedAIModel {
  id: string;
  name: string;
  provider: string;
  type: "text" | "code" | "vision" | "audio";
  costPerToken: number;
  contextWindow: number;
  capabilities: string[];
  local: boolean;
}

export interface IntegratedTool {
  id: string;
  name: string;
  type: string;
  description: string;
  setupRequired: boolean;
  localOnly: boolean;
  parameters: Record<string, any>;
}