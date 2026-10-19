# 🚀 Push to GitHub — One Command

The repo is committed and tagged locally, but the GitHub PAT lacks `repo:create` scope, so the repo must be created manually. **Two options**:

## Option A: Create via web UI (recommended)

1. Go to https://github.com/new
2. Repository name: **`dadabot`**
3. Description: _Local-first AI Agent OS — 6 free models, human-in-the-loop safety, BlockSuite canvas, OpenWork-compatible agent registry, Tauri mobile shell_
4. Visibility: **Public**
5. **DO NOT** initialize with README, .gitignore, or license
6. Click **Create repository**
7. Then run:

```bash
cd /Users/brianyeon/CodeGPT/integration-finalize
git push -u origin main
git push -u origin v0.17
```

## Option B: Use a PAT with `repo` scope

```bash
# 1. Generate a new PAT at https://github.com/settings/tokens/new
#    Scopes needed: ✓ repo (full)
# 2. Authenticate
gh auth login --with-token <(echo "$NEW_PAT")

# 3. Create + push in one shot
cd /Users/brianyeon/CodeGPT/integration-finalize
gh repo create koraussie7/dadabot \
  --public \
  --description "Local-first AI Agent OS — 6 free models, human-in-the-loop safety, BlockSuite canvas, OpenWork-compatible agent registry, Tauri mobile shell" \
  --source . \
  --remote origin \
  --push
```

## What's already done

✅ Local commit `de8e31a` (v0.18) — MuhanAI Point + growth system
✅ Tag `v0.18` (annotated)
✅ `.gitignore` excludes secrets (`.env`, `identity.json`)
✅ All 239 tests pass across 10 suites
✅ Distribution bundles built in `dist/v0.18/` (209K each)

## Build verification done

```
✓ busabase 25/25, affine 21/21, proposal-bridge 21/21,
   sam-tools 14/14, dadabot-cli 22/22, server 23/23,
   openwork-client 8/8, @agentmesh/points 60/60, points-routes 15/15
Total: 239/239 ✔
```

## Files in the commit

- `packages/` — 5 adapter packages (busabase, affine, proposal-bridge, sam-tools, dadabot-cli)
- `web-app/server/` — OpenWork-compatible HTTP server (Node, zero deps)
- `web-app/src/lib/openwork-client.ts` — typed browser client
- `web-app/src/components/RegisterFlow.tsx` — 5-step onboarding UI
- `web-app/tauri-mobile/` — iOS + Android shell
- `scripts/install/dadabot/` — one-liner installer (sh, ps1, brew, winget, snap, flathub)
- `scripts/setup/setup-free-providers.sh` — 6 provider bootstrap + --register-agent
- `scripts/setup/skill.md` — OpenWork self-registration protocol
- `INTEGRATION_MASTERPLAN.md` — full v0.17 design doc
- `HANDOFF_NEXT_AGENT.md` — handoff guide
- `.github/workflows/` — CI workflows (existing)
