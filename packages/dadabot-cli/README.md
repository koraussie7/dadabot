# DadaBot — Local-First AI Agent OS

> Your AI. Your Data. Your Rules.
> Local-first AI agent OS with 40+ free models, human-in-the-loop approval, and a block canvas.

This repository holds the **dadabot-cli's distribution surface** that works
without the dadabot.dev domain (which is currently unreachable / NXDOMAIN).
All install URLs fall back to GitHub raw mirrors.

## Install

### macOS (Homebrew Cask)
```bash
brew tap koraussie7/dadabot
brew install --cask dadabot
dadabot doctor
```

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/koraussie7/dadabot/main/install.ps1 | iex
dadabot doctor
```

### Linux / WSL / macOS (curl|bash, 60 seconds)
```bash
curl -fsSL https://raw.githubusercontent.com/koraussie7/dadabot/main/install.sh | bash
dadabot doctor
```

### Linux (Flatpak)
```bash
flatpak remote-add koraussie7 https://koraussie7.github.io/dadabot/flatpak
flatpak install koraussie7 dev.dadabot.DadaBot
```

### Mobile PWA — iOS / Android / ChromeOS
1. Visit https://koraussie7.github.io/dadabot/dashboard/
2. iOS: Safari share menu -> Add to Home Screen
3. Android/Chrome: address-bar install icon -> Install

## Quick start (CLI)
```bash
dadabot doctor                                      # system check + free-provider guide
bash scripts/setup/setup-free-providers.sh           # register Groq / Cerebras keys
node bin/dadabot.mjs run proposal.json              # 5-stage safety pipeline
node bin/dadabot.mjs approve <crId>                 # human approval
node bin/dadabot.mjs list                           # inbox
```

## Features
- 40+ free AI models with auto-failover (Groq, Cerebras, NVIDIA NIM, DeepSeek, Gemini, Mistral, ...)
- Human-in-the-loop: 3-tier permission + ChangeRequest + Inbox
- BlockSuite / Y.js reactive canvas
- 5-stage safety pipeline: ingest -> decide -> submit -> await -> complete
- PWA dashboard: works offline once installed
- Local-first: data stays on your device

## Repository layout
```
packages/dadabot-cli/               CLI source (tsx, 22 tests)
apps/dadabot-dashboard/             PWA dashboard (vite build, 383 KB)
scripts/install/dadabot/            installer + Homebrew Cask + Flatpak + release.yml
HANDOFF_NEXT_AGENT.md               cross-agent hand-off doc (diagnosis, polyfills, rollback checklist)
```

## Issues / PRs
- https://github.com/koraussie7/dadabot/issues
- https://github.com/koraussie7/dadabot/pulls

## Inbox storage backend

Two backends are available; the default is unchanged so existing installs keep working.

| Backend | Storage | Concurrency |
|---|---|---|
| `json` (default) | `~/.dadabot/inbox.json`, whole-file rewrite per mutation | Two processes can lose writes |
| `sqlite` | `~/.dadabot/inbox.db`, one transaction per mutation | Safe for CLI + dashboard at once |

Switch to SQLite:

```bash
dadabot migrate-inbox          # idempotent; legacy inbox.json is left in place
export DADABOT_INBOX_BACKEND=sqlite
dadabot list
```

Roll back by unsetting `DADABOT_INBOX_BACKEND` — the JSON file was never modified.

| Variable | Default | Meaning |
|---|---|---|
| `DADABOT_INBOX_BACKEND` | `json` | `json` or `sqlite` |
| `DADABOT_INBOX_DB` | `$DADABOT_HOME/inbox.db` | SQLite file location |

The SQLite backend uses Node's built-in `node:sqlite` (Node 22+), so there is no
native module to compile on the VPS.
