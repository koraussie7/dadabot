/**
 * Dadabot Cindy Integration - Memory System
 * 
 * Implements Cindy's memory system within Dadabot's local-first architecture.
 * Remembers corrections, preferences, and skill usage across sessions.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface CorrectionEntry {
  id: string;
  original: string;
  corrected: string;
  context: string;
  harness: string;
  timestamp: Date;
  accepted: boolean;
}

export interface CindyMemory {
  userPreferences: Record<string, any>;
  projectContext: Record<string, any>;
  correctionHistory: CorrectionEntry[];
  skillUsage: Record<string, number>;
  crossHarnessLearning: boolean;
}

export class MemorySystem {
  private memoryPath: string;
  private memory: CindyMemory;

  constructor(baseDir: string = "$HOME/.dadabot") {
    const homeDir = existsSync(baseDir) ? baseDir : join(baseDir, "cindy-integration");
    mkdirSync(homeDir, { recursive: true });
    
    this.memoryPath = join(homeDir, "memory.json");
    this.memory = this.loadMemory();
  }

  private loadMemory(): CindyMemory {
    if (existsSync(this.memoryPath)) {
      const raw = require("fs").readFileSync(this.memoryPath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        userPreferences: parsed.userPreferences || {},
        projectContext: parsed.projectContext || {},
        correctionHistory: parsed.correctionHistory || [],
        skillUsage: parsed.skillUsage || {},
        crossHarnessLearning: parsed.crossHarnessLearning || false,
      };
    }
    return {
      userPreferences: {},
      projectContext: {},
      correctionHistory: [],
      skillUsage: {},
      crossHarnessLearning: false,
    };
  }

  save(): void {
    require("fs").writeFileSync(this.memoryPath, JSON.stringify(this.memory, null, 2));
  }

  recordCorrection(
    original: string,
    corrected: string,
    context: string,
    harness: string
  ): string {
    const entry: CorrectionEntry = {
      id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      original,
      corrected,
      context,
      harness,
      timestamp: new Date(),
      accepted: true,
    };

    this.memory.correctionHistory.push(entry);
    
    // Keep only last 500 corrections
    if (this.memory.correctionHistory.length > 500) {
      this.memory.correctionHistory = this.memory.correctionHistory.slice(-500);
    }

    // Track preferred harness
    if (!this.memory.userPreferences.preferredHarness) {
      this.memory.userPreferences.preferredHarness = harness;
    }

    this.save();
    return entry.id;
  }

  recordSkillUsage(skillId: string): void {
    this.memory.skillUsage[skillId] = (this.memory.skillUsage[skillId] || 0) + 1;
    this.save();
  }

  getPreferences(): Record<string, any> {
    return this.memory.userPreferences;
  }

  getCorrectionCount(): number {
    return this.memory.correctionHistory.length;
  }

  getSkillUsage(): Record<string, number> {
    return { ...this.memory.skillUsage };
  }
}