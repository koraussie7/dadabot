# Cindy and Dadabot Integration

## Philosophy

**Cindy**: "Consider it done. The open-source AI agent that works out of the box."
**Dadabot**: "Your AI. Your Data. Your Rules."

Integration combines Cindy's out-of-the-box functionality with Dadabot's local-first privacy.

## Core Components

### 1. Memory System
- Correction tracking for AI learning
- Skill usage tracking across sessions
- User preferences persistence
- Fully local storage (no cloud dependency)

### 2. Harness Management
- Claude Code, Codex, Local models
- Dynamic switching based on task
- Automatic failover between 40+ models

### 3. Skills System
- 34+ pre-built skills
- Categories: coding, research, writing, automation, data
- Executable via natural language commands

### 4. Model Integration
- Dadabot's 40+ models + Cindy's preferred models
- Local Ollama support
- Auto routing based on task type

### 5. Tool Integration
- 249+ Dadabot tools
- Cindy's essential harnesses
- Browser automation, terminal, git, etc.

## Quick Start

```bash
# Install Dadabot
brew install dadabot/tap/dadabot

# Initialize integration
dadabot integrate cindy --mode full

# Start using Cindy skills
dadabot skill generate-component --component-name "Header"

# Switch harnesses
dadabot harness switch claude-code

# Check status
dadabot integration status
```

## Configuration

```yaml
integration:
  cindyMode: "full"           # full | partial | off
  localFirstPriority: true     # Prefer local models
  enableHarnessSwitching: true # Allow dynamic switching
  skillSharing: "both"         # dadabot-hub | cindy-marketplace | both
  modelRouting: "auto"         # auto | plan | agent
  crossPlatformSync: "none"    # none | dropbox | github | custom
```

## License

MIT License - free to use, modify, and distribute with attribution.