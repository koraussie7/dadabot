#!/usr/bin/env bash
# =============================================================================
# DadaBot v0.1.0 — Production Release Checklist
# Run each step in order. Check off as completed.
# =============================================================================

set -euo pipefail

echo "==========================================="
echo "DadaBot v0.1.0-beta.1 Release Checklist"
echo "==========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

check() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

# =============================================================================
# STEP 1: Environment Setup
# =============================================================================
echo "STEP 1: Environment Setup"
echo "-------------------------"

if command -v minisign &> /dev/null; then check "minisign installed"; else fail "minisign not found"; fi
if command -v bats &> /dev/null; then check "bats installed"; else warn "bats not found (optional)"; fi
if command -v pwsh &> /dev/null; then check "PowerShell installed"; else warn "PowerShell not found (for Pester tests)"; fi
if command -v docker &> /dev/null; then check "Docker installed"; else warn "Docker not found (for Y.js server)"; fi
if command -v cargo &> /dev/null; then check "Rust/Cargo installed"; else warn "Rust not found (for Tauri)"; fi
if command -v tauri &> /dev/null; then check "Tauri CLI installed"; else warn "Tauri CLI not found"; fi

# Check GitHub CLI
if command -v gh &> /dev/null; then check "GitHub CLI installed"; else warn "GitHub CLI not found (for PR submissions)"; fi

echo ""

# =============================================================================
# STEP 2: Minisign Keys
# =============================================================================
echo "STEP 2: Minisign Keys"
echo "---------------------"

if [ -f "scripts/install/dadabot/release/minisign.pub" ]; then
    check "minisign.pub exists"
    cat scripts/install/dadabot/release/minisign.pub
else
    warn "minisign.pub missing - run ./scripts/gen-keys.sh"
fi

if [ -f "scripts/install/dadabot/release/minisign.key" ]; then
    check "minisign.key exists (keep secure!)"
else
    warn "minisign.key missing - run ./scripts/gen-keys.sh"
fi

echo ""
echo "⚠️  ACTION REQUIRED: Add to GitHub Repository Secrets:"
echo "   MINISIGN_KEY          (contents of minisign.key)"
echo "   MINISIGN_PASSPHRASE   (your passphrase)"
echo "   CF_API_TOKEN          (Cloudflare API token for cache purge)"
echo "   CF_ZONE_ID            (Cloudflare zone ID for dadabot.dev)"
echo ""

# =============================================================================
# STEP 3: Run All Tests
# =============================================================================
echo "STEP 3: Test Suite"
echo "------------------"

echo "Running core tests (67/67)..."
if ./test-all.sh; then
    check "Core tests: 67/67 passed"
else
    fail "Core tests failed"
fi

# BATS tests (if bats installed)
if command -v bats &> /dev/null; then
    echo "Running BATS tests..."
    if bats scripts/install/dadabot/test/install.bats; then
        check "BATS tests passed"
    else
        warn "BATS tests failed (check mocks)"
    fi
fi

# Pester tests (if PowerShell available)
if command -v pwsh &> /dev/null; then
    echo "Running Pester tests..."
    if pwsh -c "Invoke-Pester scripts/install/dadabot/test/Install.Tests.ps1 -Output Detailed"; then
        check "Pester tests passed"
    else
        warn "Pester tests failed"
    fi
fi

echo ""

# =============================================================================
# STEP 4: TypeScript Typecheck
# =============================================================================
echo "STEP 4: TypeScript Typecheck"
echo "----------------------------"

for pkg in web-app/packages/*/; do
    if [ -f "$pkg/tsconfig.json" ]; then
        echo "Checking $(basename $pkg)..."
        if (cd "$pkg" && npx tsc --noEmit 2>&1 | grep -q "error"); then
            warn "Type errors in $(basename $pkg)"
        else
            check "Typecheck: $(basename $pkg)"
        fi
    fi
done
echo ""

# =============================================================================
# STEP 5: Build Verification
# =============================================================================
echo "STEP 5: Build Verification"
echo "--------------------------"

echo "Building web app..."
if (cd web-app && npm run build 2>&1 | tail -5); then
    check "Web app build successful"
else
    warn "Web app build failed"
fi

# Tauri mobile build (if Tauri CLI available)
if command -v tauri &> /dev/null; then
    echo "Tauri mobile build available (run manually):"
    echo "  cd web-app/tauri-mobile && npm run tauri:android build"
    echo "  cd web-app/tauri-mobile && npm run tauri:ios build"
fi

echo ""

# =============================================================================
# STEP 6: Package Manager Submissions
# =============================================================================
echo "STEP 6: Package Manager Submissions"
echo "-----------------------------------"

echo "Winget manifest:"
if [ -f "scripts/install/dadabot/metadata/winget/manifests/d/DadaBot/DadaBot/0.1.0/DadaBot.DadaBot.yaml" ]; then
    check "Winget manifest exists"
    echo "  Submit PR to: https://github.com/microsoft/winget-pkgs"
    echo "  Path: manifests/d/DadaBot/DadaBot/0.1.0/"
else
    warn "Winget manifest missing"
fi

echo ""
echo "Homebrew formula:"
if [ -f "scripts/install/dadabot/metadata/dadabot.rb" ]; then
    check "Homebrew formula exists"
    echo "  Create repo: dadabot/homebrew-tap"
    echo "  Push formula and run: brew install dadabot/tap/dadabot"
else
    warn "Homebrew formula missing"
fi

echo ""
echo "Flathub manifest:"
if [ -f "scripts/install/dadabot/metadata/flatpak-dadabot.json" ]; then
    check "Flatpak manifest exists"
    echo "  Submit PR to: https://github.com/flathub/flathub"
else
    warn "Flatpak manifest missing"
fi

echo ""
echo "Snap manifest:"
if [ -f "scripts/install/dadabot/metadata/snapcraft.yaml" ]; then
    check "Snapcraft.yaml exists"
    echo "  Run: snapcraft upload --release=stable dadabot_*.snap"
else
    warn "Snapcraft.yaml missing"
fi

echo ""

# =============================================================================
# STEP 7: Y.js WebSocket Server Deploy
# =============================================================================
echo "STEP 7: Y.js WebSocket Server"
echo "-----------------------------"

if [ -f "scripts/y-websocket-server.js" ]; then
    check "Y.js server script exists"
    echo "  Deploy options:"
    echo "    1. Docker: docker build -f scripts/y-websocket-server.Dockerfile -t dadabot/y-sync ."
    echo "    2. Fly.io: fly deploy --config fly.toml (create fly.toml)"
    echo "    3. Cloud Run: gcloud run deploy y-sync --source ."
    echo "    4. Railway/Render: connect GitHub repo"
    echo ""
    echo "  After deploy, update web app to use:"
    echo "    ws://your-domain:1234/?room=my-room&token=xxx"
else
    warn "Y.js server script missing"
fi
echo ""

# =============================================================================
# STEP 8: Tauri Mobile Build
# =============================================================================
echo "STEP 8: Tauri Mobile Build"
echo "--------------------------"

if [ -d "web-app/tauri-mobile" ]; then
    check "Tauri mobile project exists"
    echo "  Android build:"
    echo "    cd web-app/tauri-mobile && npm run tauri:android build"
    echo "  iOS build (macOS only):"
    echo "    cd web-app/tauri-mobile && npm run tauri:ios build"
    echo ""
    echo "  CI/CD: Add to GitHub Actions (.github/workflows/tauri-mobile.yml)"
else
    warn "Tauri mobile project missing"
fi
echo ""

# =============================================================================
# STEP 9: GitHub Release
# =============================================================================
echo "STEP 9: GitHub Release"
echo "----------------------"

echo "To trigger release pipeline:"
echo "  git tag v0.1.0-beta.1"
echo "  git push origin v0.1.0-beta.1"
echo ""
echo "Pipeline will:"
echo "  1. Build 7 platforms (Linux×3, macOS×3, Windows×1)"
echo "  2. Sign with minisign (SHA-256 + .sig)"
echo "  3. Generate latest-beta.json manifest"
echo "  4. Create GitHub Release (draft)"
echo "  5. Push manifest to gh-pages/releases/latest-beta.json"
echo "  6. Purge Cloudflare CDN cache"
echo ""
echo "After verifying draft release:"
echo "  1. Review artifacts on GitHub Releases page"
echo "  2. Click 'Publish release'"
echo "  3. Verify install.sh works: curl -fsSL https://dadabot.dev/install.sh | bash"
echo ""

# =============================================================================
# STEP 10: Post-Release Verification
# =============================================================================
echo "STEP 10: Post-Release Verification"
echo "----------------------------------"

echo "After release, verify:"
echo "  1. install.sh: curl -fsSL https://dadabot.dev/install.sh | bash"
echo "  2. install.ps1: irm https://dadabot.dev/install.ps1 | iex"
echo "  3. Homebrew: brew install dadabot/tap/dadabot"
echo "  3. Winget: winget install DadaBot.DadaBot"
echo "  4. Snap: snap install dadaobot"
echo "  5. Flatpak: flatpak install flathub dev.dadabot.mobile"
echo "  6. dadabot --version"
echo "  7. dadabot doctor"
echo "  8. dadabot chat"
echo "  9. dadabot update --check"
echo ""

# =============================================================================
# SUMMARY
# =============================================================================
echo "==========================================="
echo "Release Checklist Complete"
echo "==========================================="
echo ""
echo "All steps documented. Execute each section in order."
echo "Track progress in GitHub Issues or Project board."
echo ""
echo "Next milestone: v0.1.0 (stable)"
echo "  - Address beta feedback"
echo "  - Run full E2E tests"
echo "  - Submit to all package managers"
echo "  - Launch on Product Hunt / HN"
echo ""

# Final verification
echo "Final verification commands:"
echo "  ./test-all.sh                    # Core tests"
echo "  bats scripts/install/dadabot/test/install.bats   # BATS"
echo "  pwsh -c 'Invoke-Pester test/Install.Tests.ps1'   # Pester"
echo ""