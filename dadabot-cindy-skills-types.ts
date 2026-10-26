/**
 * Dadabot Cindy Integration - Skills System (Core Types)
 * 
 * Implements Cindy's skill system within Dadabot.
 * 34+ pre-built capabilities for coding, research, writing, automation, and data.
 */

export interface CindySkill {
  id: string;
  name: string;
  description: string;
  category: "coding" | "research" | "writing" | "automation" | "data";
  complexity: "beginner" | "intermediate" | "advanced";
  setupRequired: boolean;
  params: Record<string, any>;
}

export interface SkillExecutionResult {
  success: boolean;
  result: any;
  executionTime: number;
  skillId: string;
}

export interface SkillCategoryStats {
  category: CindySkill["category"];
  count: number;
  avgUsage: number;
}