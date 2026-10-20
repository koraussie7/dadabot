# DadaBot — Local-First AI Agent OS

> ⚠️ **다른 에이전트 필독**: 현재 정리 작업 진행 중 — [CLEANUP_IN_PROGRESS.md](CLEANUP_IN_PROGRESS.md)를 먼저 읽으세요.

> **"Your AI. Your Data. Your Rules."**

DadaBot is a **local-first AI agent operating system** that runs entirely on your device. No cloud dependencies, no API keys required, no subscription fees.

## 🌟 Key Features

| Feature | Description |
|---------|-------------|
| **🆓 40+ Free AI Models** | Auto-rotating across Groq, Cerebras, NVIDIA NIM, DeepSeek, Gemini, Mistral, SambaNova, Together, Fireworks, Ollama |
| **🔧 249 Real Tools** | Terminal, Git, code editing with syntax validation, browser automation, cron jobs, multi-agent swarms |
| **🎯 34 Skills** | Pre-built capabilities for coding, research, writing, automation, trading |
| **🎨 Creative Suite** | Free-first image/video generation (Pollinations, Together, HF, NVIDIA, Cloudflare) + persistent media vault |
| **📈 FlipIt Trading Desk** | Kelly criterion position sizing, watchtower scheduled jobs |
| **📱 Native Mobile** | iOS App Store (2.0.0), Android (Expo debug APK), optional desktop pairing |
| **🔒 Local-First** | Chats/memories/vault in Markdown + SQLite, API keys in local env, Ollama = fully offline |
| **👥 Human-in-the-Loop** | 3-tier permission system (read/changeRequest/autoMerge) with GitHub PR bridge |
| **📊 Visual Canvas** | BlockSuite/Y.js reactive blocks (AI messages, human notes, code snippets) |
| **🔄 Auto-Updates** | Signed binaries, SHA-256 + minisign verification, background checks |

## 🚀 Quick Start

```bash
# macOS / Linux (one-liner)
curl -fsSL https://dadabot.dev/install.sh | bash

# Windows (PowerShell)
irm https://dadabot.dev/install.ps1 | iex

# Or via package managers
brew install dadabot/tap/dadabot        # macOS
winget install DadaBot.DadaBot          # Windows
snap install dadaobot                   # Linux
flatpak install flathub dev.dadabot.mobile  # Flatpak

# Verify
dadabot --version
dadabot doctor
dadabot chat
```

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      DADABOT ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Web App    │  │  Tauri Mobile│  │   CLI (dadabot)      │  │
│  │  (React 18)  │  │  (Tauri v2)  │  │   (Node 22+)         │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬────────────┘  │
│         │                 │                      │               │
│         └─────────────────┼──────────────────────┘               │
│                           ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              PROTOCOL HUB (Rust)                         │    │
│  │  MCP Server │ MCP Client │ MCP Apps │ A2A │ WebMCP      │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                 │                     │               │
│    ┌────┴────┐      ┌────┴────┐            ┌────┴────┐        │
│    ▼         ▼      ▼         ▼            ▼         ▼        │
│  MCP      A2A     Skills    WebMCP     BITTERBOT    SAM      │
│  Servers  Agents  Registry  Bridge     (49 providers)       │
│                                                         │       │
│  • 49-provider auto-failover                            │       │
│  • Model routing (auto/plan/agent)                      │       │
│  • Cooldown/quarantine logic                            │       │
└─────────────────────────────────────────────────────────┘
```

## 📦 Project Structure

```
integration-finalize/
├── web-app/                    # Main web console (React + Vite)
│   ├── src/
│   │   ├── App.tsx             # Routing + 3 pages (Console/Inbox/Canvas)
│   │   ├── components/         # UI components
│   │   └── pages/              # Page components
│   ├── packages/               # Core business logic (3 packages)
│   │   ├── busabase-adapter/   # Human approval workflow (25 tests)
│   │   ├── affine-adapter/     # BlockSuite canvas + Y.js (21 tests)
│   │   ├── proposal-bridge/    # 5-stage safety pipeline (21 tests)
│   │   └── dadabot-cli/        # CLI with update command
│   └── tauri-mobile/           # Tauri v2 mobile app (iOS/Android)
│
├── packages/                   # Core packages (also in web-app/packages/)
│   ├── busabase-adapter/
│   ├── affine-adapter/
│   └── proposal-bridge/
│
├── scripts/
│   ├── install/dadabot/        # 60-sec installer (sh/ps1)
│   │   ├── install.sh          # Unix installer (291 LOC)
│   │   ├── install.ps1         # Windows installer (228 LOC)
│   │   ├── release/            # Release pipeline
│   │   └── test/               # BATS + Pester tests
│   ├── y-websocket-server.js   # Y.js sync server
│   ├── fly.toml                # Fly.io deploy config
│   ├── Dockerfile              # Y.js server Docker image
│   ├── gen-keys.sh             # Minisign key generator
│   ├── release-checklist.sh    # Release verification
│   └── *.yml                   # GitHub Actions workflows
│
├── .github/workflows/          # CI/CD pipelines
│   ├── core-ci.yml             # Main CI (typecheck, test, lint, build)
│   ├── installer-tests.yml     # BATS + Pester tests
│   ├── tauri-mobile.yml        # iOS/Android builds
│   ├── minisign-keys.yml       # Key generation
│   ├── package-submissions.yml # Winget/Homebrew/Flatpak/Snap PRs
│   └── release.yml             # 7-platform release pipeline
│
└── test-all.sh                 # Run all 67 tests
```

## 🧪 Testing

```bash
# All 67 tests
./test-all.sh

# Individual packages
cd packages/busabase-adapter && node --experimental-strip-types --test test/busabase.test.ts
cd packages/affine-adapter && node --experimental-strip-types --test test/affine.test.ts
cd packages/proposal-bridge && node --experimental-strip-types --test test/pipeline.test.ts

# BATS tests (install.sh)
bats scripts/install/dadabot/test/install.bats

# Pester tests (install.ps1)
pwsh -c "Invoke-Pester scripts/install/dadabot/test/Install.Tests.ps1"
```

## 🔧 Development

```bash
# Web app
cd web-app
npm install
npm run dev          # http://localhost:5173
npm run build
npm run typecheck

# Tauri mobile
cd web-app/tauri-mobile
npm install
npm run tauri:dev    # Desktop dev
npm run tauri:android build
npm run tauri:ios build

# Y.js sync server
cd scripts
npm install
npm run dev          # WebSocket on ws://localhost:1234

# CLI
cd packages/dadabot-cli
# Run directly with Node 22+
node --experimental-strip-types src/cli.ts --help
```

## 🚢 Release Process

```bash
# 1. Generate minisign keys (one-time)
./scripts/gen-keys.sh
# Add minisign.key to GitHub Secrets: MINISIGN_KEY, MINISIGN_PASSPHRASE

# 2. Run full verification
./scripts/release-checklist.sh

# 3. Tag and push (triggers 7-platform build)
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1

# 3. Verify draft release on GitHub, then publish
# 4. Submit package manager PRs (auto-triggered)
# 5. Verify all install methods work
```

## 📦 Package Manager Support

| Platform | Command | Status |
|----------|---------|--------|
| **Homebrew** | `brew install dadabot/tap/dadabot` | ✅ Formula ready |
| **Winget** | `winget install DadaBot.DadaBot` | ✅ Manifest ready |
| **Snap** | `snap install dadaobot` | ✅ Snapcraft.yaml ready |
| **Flatpak** | `flatpak install flathub dev.dadabot.mobile` | ✅ Manifest ready |
| **npm** | `npm install -g @dadabot/cli` | Planned |

## 🔐 Security

- **Minisign** signatures on all release artifacts
- **SHA-256** checksums in manifest
- **Auto-updater** verifies both before applying
- **Local-first**: No data leaves your device without consent
- **Human-in-the-loop**: All sensitive actions require approval

## 🤝 Contributing

```bash
# 1. Fork & clone
# 2. Create feature branch
# 3. Make changes
# 4. Run tests: ./test-all.sh
# 5. Typecheck: npx tsc --noEmit (in each package)
# 6. Submit PR
```

## 📄 License

MIT License — see [LICENSE](LICENSE)

---

**Built with ❤️ by the DadaBot Team** — *Local-first AI that actually works.*