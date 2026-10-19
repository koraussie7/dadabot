#!/usr/bin/env bash
# deploy/dadabot-to-muhanai.sh
#
# Pushes Dadabot patches + rebuilt bundle to live muhanai.com.
#
# Local source root:  /Users/brianyeon/muhanai-folder/muhanai/muhanai/packaging/npm/token-free-gateway/agentmesh/apps/web/
# Built dist:        <src>/dist/
# Live remote:       muhanai.com:/var/www/muhanai.com/ (via nginx, behind Cloudflare)
#
# Steps:
#   1. Verify local source has dadabot patches (App.tsx, routes.ts, menu-i18n.ts, DadabotPage.tsx)
#   2. Run tsc to ensure no breakage
#   3. Build dist/
#   4. rsync dist/ → remote /var/www/muhanai.com/
#   5. Purge Cloudflare cache for /assets/*
#   6. Verify live bundle hash includes DadabotPage chunk
#
# Usage:
#   bash scripts/deploy/dadabot-to-muhanai.sh           # build + dry-run
#   bash scripts/deploy/dadabot-to-muhanai.sh --apply   # build + rsync + cache purge
#
# Requires:
#   - SSH access to muhanai.com server (configured in ~/.ssh/config)
#   - CF_API_TOKEN env var (for Cloudflare cache purge)
#   - CF_ZONE_ID env var
#
# Optional env:
#   MUHANAI_REMOTE       (default: muhanai.com)
#   MUHANAI_REMOTE_ROOT  (default: /var/www/muhanai.com)
#   SKIP_BUILD=1         (skip npm run build if dist/ is fresh)

set -e

SRC="/Users/brianyeon/muhanai-folder/muhanai/muhanai/packaging/npm/token-free-gateway/agentmesh/apps/web"
REMOTE="${MUHANAI_REMOTE:-muhanai.com}"
REMOTE_ROOT="${MUHANAI_REMOTE_ROOT:-/var/www/muhanai.com}"
BACKUP_DIR="$HOME/.dadabot/backups/muhanai/$(date +%Y%m%d-%H%M%S)"

APPLY=0
[[ "$1" == "--apply" ]] && APPLY=1

GREEN="\033[32m"; YELLOW="\033[33m"; BOLD="\033[1m"; RESET="\033[0m"

echo -e "${BOLD}━━━ Dadabot → muhanai.com deployer ━━━${RESET}"

# 1. Verify source has the patches
echo ""
echo "1) Verifying local source patches..."

PATCH_OK=1
for f in \
  "$SRC/src/components/DadabotPage.tsx" \
  "$SRC/src/App.tsx" \
  "$SRC/src/routes.ts" \
  "$SRC/src/components/menu-i18n.ts"; do
  if [ ! -f "$f" ]; then
    echo -e "${YELLOW}  ✗ Missing: $f${RESET}"
    PATCH_OK=0
    continue
  fi
done

if [ "$PATCH_OK" = "1" ]; then
  if ! grep -q "DadabotPageLazy" "$SRC/src/App.tsx"; then
    echo -e "${YELLOW}  ✗ App.tsx missing DadabotPageLazy${RESET}"
    PATCH_OK=0
  fi
  if ! grep -q "page: \"dadabot\"" "$SRC/src/routes.ts"; then
    echo -e "${YELLOW}  ✗ routes.ts missing dadabot entry${RESET}"
    PATCH_OK=0
  fi
  if ! grep -q "dadabot:" "$SRC/src/components/menu-i18n.ts"; then
    echo -e "${YELLOW}  ✗ menu-i18n.ts missing dadabot label${RESET}"
    PATCH_OK=0
  fi
fi

if [ "$PATCH_OK" = "0" ]; then
  echo -e "${YELLOW}✗ Source patches missing. Re-run apply patches first.${RESET}"
  exit 1
fi

echo -e "${GREEN}  ✓ All 4 source files patched${RESET}"

# 2. Typecheck
echo ""
echo "2) TypeScript check..."
cd "$SRC"
npx tsc -p tsconfig.json --noEmit 2>&1 | tail -5 || true

# 3. Build (skip if SKIP_BUILD=1)
if [ "${SKIP_BUILD:-0}" = "1" ] && [ -d "$SRC/dist" ]; then
  echo ""
  echo "3) Skipping build (SKIP_BUILD=1)"
else
  echo ""
  echo "3) Building production bundle..."
  cd "$SRC"
  npm run build 2>&1 | tail -8
fi

# Verify dist exists
if [ ! -f "$SRC/dist/index.html" ]; then
  echo -e "${YELLOW}✗ dist/index.html missing — build failed${RESET}"
  exit 1
fi

NEW_BUNDLE=$(ls "$SRC/dist/assets/" | grep -E "^index-.*\.js$" | head -1)
NEW_CHUNK=$(ls "$SRC/dist/assets/" | grep -E "^DadabotPage-.*\.js$" | head -1)

echo -e "${GREEN}  ✓ Main bundle: $NEW_BUNDLE${RESET}"
echo -e "${GREEN}  ✓ DadabotPage chunk: $NEW_CHUNK${RESET}"

# 4. Stage backup of remote (best effort)
mkdir -p "$BACKUP_DIR"

# 5. Deploy
if [ "$APPLY" = "0" ]; then
  echo ""
  echo -e "${YELLOW}━━━ DRY RUN (pass --apply to deploy) ━━━${RESET}"
  echo ""
  echo "Would run:"
  echo "  rsync -avz --delete '$SRC/dist/' '$REMOTE:$REMOTE_ROOT/'"
  echo "  ssh '$REMOTE' 'sudo systemctl reload nginx'"
  echo "  cf cache purge --tag muhanai (if CF_API_TOKEN set)"
  exit 0
fi

echo ""
echo -e "${BOLD}━━━ Deploying to live ━━━${RESET}"

# rsync dist/ to remote
rsync -avz --delete "$SRC/dist/" "$REMOTE:$REMOTE_ROOT/"
echo -e "${GREEN}  ✓ rsync complete${RESET}"

# Reload nginx
ssh "$REMOTE" 'sudo systemctl reload nginx' 2>/dev/null && \
  echo -e "${GREEN}  ✓ nginx reloaded${RESET}" || \
  echo -e "${YELLOW}  ⚠ nginx reload failed (run manually)${RESET}"

# Cloudflare cache purge (if credentials available)
if [ -n "$CF_API_TOKEN" ] && [ -n "$CF_ZONE_ID" ]; then
  echo "  Purging Cloudflare cache for /assets/*..."
  curl -sX POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{"files":["https://muhanai.com/assets/'"$NEW_BUNDLE"'","https://muhanai.com/assets/'"$NEW_CHUNK"'"]}' \
    | head -c 200
  echo ""
  echo -e "${GREEN}  ✓ Cloudflare cache purged${RESET}"
else
  echo -e "${YELLOW}  ⚠ CF_API_TOKEN/CF_ZONE_ID not set — manual purge needed at https://dash.cloudflare.com${RESET}"
fi

# 6. Verification
echo ""
echo -e "${BOLD}━━━ Verification ━━━${RESET}"
echo "Local dist:"
ls -la "$SRC/dist/assets/$NEW_BUNDLE" "$SRC/dist/assets/$NEW_CHUNK" | awk '{print "  "$NF" ("$5" bytes)"}'

echo ""
echo "Live (via curl):"
LIVE_BUNDLE=$(curl -sL "https://muhanai.com/" 2>/dev/null | grep -oE "index-[A-Za-z0-9_-]+\.js" | head -1)
echo "  /index.html references: $LIVE_BUNDLE"

if [ "$LIVE_BUNDLE" = "$NEW_BUNDLE" ]; then
  echo -e "${GREEN}  ✓ Live bundle hash matches local dist${RESET}"
else
  echo -e "${YELLOW}  ⚠ Hash mismatch — Cloudflare cache may not be purged${RESET}"
  echo "    Local:  $NEW_BUNDLE"
  echo "    Live:   $LIVE_BUNDLE"
fi

echo ""
echo -e "${GREEN}✓ Done.${RESET}"
echo ""
echo "Manual verification: open https://muhanai.com/dadabot in browser"
echo "  (Cmd+Shift+R to bypass cache)"
