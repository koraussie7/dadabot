/**
 * Dadabot Cindy Integration - Harness Management
 * 
 * Manages AI model harnesses (Claude Code, Codex, etc.) within Dadabot.
 * Enables dynamic harness switching and capability matching.
 */

export interface CindyHarness {
  name: string;
  type: "coding" | "general";
  status: "available" | "unavailable" | "error";
  capabilities: string[];
  apiKey?: string;
}

export interface HarnessSwitchResult {
  success: boolean;
  message: string;
  currentHarness: CindyHarness | null;
}

export class HarnessManager {
  private harnesses: CindyHarness[];
  private currentHarnessName: string | null = null;

  constructor() {
    this.harnesses = this.initializeHarnesses();
    // Set default current harness
    const localHarness = this.harnesses.find(h => h.name === "local");
    if (localHarness) {
      this.currentHarnessName = localHarness.name;
    }
  }

  private initializeHarnesses(): CindyHarness[] {
    return [
      {
        name: "claude-code",
        type: "coding",
        status: "available",
        capabilities: ["code-generation", "debugging", "refactoring", "test-generation"],
      },
      {
        name: "codex",
        type: "coding",
        status: "available",
        capabilities: ["code-generation", "explanation", "documentation"],
      },
      {
        name: "local",
        type: "general",
        status: "available",
        capabilities: ["text-generation", "analysis", "conversation"],
        // No API key needed - runs locally via Ollama
      },
      {
        name: "groq",
        type: "general",
        status: "available",
        capabilities: ["text-generation", "fast-inference"],
        // Requires API key
      },
    ];
  }

  getCurrentHarness(): CindyHarness | null {
    if (this.currentHarnessName) {
      return this.harnesses.find(h => h.name === this.currentHarnessName) || null;
    }
    return null;
  }

  getHarness(name: string): CindyHarness | undefined {
    return this.harnesses.find(h => h.name === name);
  }

  getAvailableHarnesses(): CindyHarness[] {
    return this.harnesses.filter(h => h.status === "available");
  }

  switchHarness(name: string): HarnessSwitchResult {
    const harness = this.harnesses.find(h => h.name === name);
    if (!harness) {
      return {
        success: false,
        message: `Harness '${name}' not found. Available: ${this.harnesses.map(h => h.name).join(", ")}`,
        currentHarness: this.getCurrentHarness(),
      };
    }

    this.currentHarnessName = name;

    return {
      success: true,
      message: `Successfully switched to harness: ${name}`,
      currentHarness: harness,
    };
  }

  getCapabilitiesForTask(taskType: "coding" | "general" | "analysis" | "conversation"): CindyHarness[] {
    return this.harnesses.filter(h =>
      h.type === taskType || 
      (taskType === "general" && h.type !== "coding") ||
      h.capabilities.some(c => c.toLowerCase().includes(taskType))
    );
  }
}