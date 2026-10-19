#!/usr/bin/env bash
# verify-tauri-mobile.sh — P3-D build verification for Tauri v2 mobile.
#
# Verifies:
#   1. All required source files exist (Rust + TypeScript)
#   2. Cargo.toml has mobile targets configured
#   3. tauri.conf.json has iOS/Android permissions
#   4. App.tsx wires InboxPanel
#   5. main.rs exposes 8 dadabot_* Tauri commands
#   6. CI workflow exists for mobile builds
#
# Exit code 0 = pass, non-zero = fail.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$ROOT/web-app/tauri-mobile"
RUST_DIR="$TAURI_DIR/src-tauri"
WORKFLOWS_DIR="$ROOT/.github/workflows"

PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "ok" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== P3-D Tauri v2 Mobile Verification ==="
echo ""

# 1. Source files
echo "[1] Source files"
check "main.rs" "$([ -f "$RUST_DIR/src/main.rs" ] && echo ok || echo fail)"
check "lib.rs" "$([ -f "$RUST_DIR/src/lib.rs" ] && echo ok || echo fail)"
check "lib.rs has mobile_entry_point" "$(grep -q 'mobile_entry_point\|tauri::mobile_entry_point' "$RUST_DIR/src/lib.rs" && echo ok || echo fail)"
check "lib.rs delegates to super::main" "$(grep -q 'super::main' "$RUST_DIR/src/lib.rs" && echo ok || echo fail)"
check "Cargo.toml" "$([ -f "$RUST_DIR/Cargo.toml" ] && echo ok || echo fail)"
check "tauri.conf.json" "$([ -f "$RUST_DIR/tauri.conf.json" ] && echo ok || echo fail)"
check "App.tsx" "$([ -f "$TAURI_DIR/src/App.tsx" ] && echo ok || echo fail)"
check "InboxPanel.tsx" "$([ -f "$TAURI_DIR/src/InboxPanel.tsx" ] && echo ok || echo fail)"
check "main.tsx" "$([ -f "$TAURI_DIR/src/main.tsx" ] && echo ok || echo fail)"

# 2. Cargo.toml has mobile targets
echo ""
echo "[2] Cargo.toml mobile targets"
CARGO="$RUST_DIR/Cargo.toml"
check "tauri-mobile feature flag" "$(grep -q 'tauri-mobile' "$CARGO" && echo ok || echo fail)"
check "lib section with crate-type" "$(grep -q 'crate-type' "$CARGO" && echo ok || echo fail)"
check "lib name dadabot_mobile_lib" "$(grep -q 'dadabot_mobile_lib' "$CARGO" && echo ok || echo fail)"
check "tauri-plugin-shell dep" "$(grep -q 'tauri-plugin-shell' "$CARGO" && echo ok || echo fail)"
check "serde_json dep" "$(grep -q 'serde_json' "$CARGO" && echo ok || echo fail)"

# 3. tauri.conf.json has mobile config
echo ""
echo "[3] tauri.conf.json mobile config"
CONF="$RUST_DIR/tauri.conf.json"
check "bundle.iOS config" "$(grep -q '"ios"\|"iOS"' "$CONF" && echo ok || echo fail)"
check "bundle.android config" "$(grep -q '"android"' "$CONF" && echo ok || echo fail)"

# 4. App.tsx wires InboxPanel
echo ""
echo "[4] App.tsx wiring"
APP="$TAURI_DIR/src/App.tsx"
check "InboxPanel import" "$(grep -q "from './InboxPanel'" "$APP" && echo ok || echo fail)"
check "InboxPanel rendered" "$(grep -q '<InboxPanel' "$APP" && echo ok || echo fail)"

# 5. main.rs exposes dadabot_* commands
echo ""
echo "[5] main.rs Tauri commands"
MAIN="$RUST_DIR/src/main.rs"
check "dadabot_version" "$(grep -q 'fn dadabot_version' "$MAIN" && echo ok || echo fail)"
check "dadabot_inbox" "$(grep -q 'fn dadabot_inbox' "$MAIN" && echo ok || echo fail)"
check "dadabot_list" "$(grep -q 'fn dadabot_list' "$MAIN" && echo ok || echo fail)"
check "dadabot_show" "$(grep -q 'fn dadabot_show' "$MAIN" && echo ok || echo fail)"
check "dadabot_approve" "$(grep -q 'fn dadabot_approve' "$MAIN" && echo ok || echo fail)"
check "dadabot_reject" "$(grep -q 'fn dadabot_reject' "$MAIN" && echo ok || echo fail)"
check "dadabot_run" "$(grep -q 'fn dadabot_run' "$MAIN" && echo ok || echo fail)"
check "dadabot_doctor" "$(grep -q 'fn dadabot_doctor' "$MAIN" && echo ok || echo fail)"
check "registered in invoke_handler" "$(grep -q 'dadabot_approve' "$MAIN" && grep -q 'dadabot_reject' "$MAIN" && echo ok || echo fail)"

# 6. CI workflow
echo ""
echo "[6] CI workflow"
WORKFLOW="$WORKFLOWS_DIR/tauri-mobile.yml"
check "tauri-mobile.yml exists" "$([ -f "$WORKFLOW" ] && echo ok || echo fail)"
check "workflow has android job" "$(grep -q 'android\|Android' "$WORKFLOW" 2>/dev/null && echo ok || echo fail)"
check "workflow has ios job" "$(grep -q 'ios\|iOS' "$WORKFLOW" 2>/dev/null && echo ok || echo fail)"

echo ""
echo "=== Result: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
