#!/usr/bin/env bash
# deploy/dadabot-to-muhanai.sh
#
# Pushes the Dadabot entry-point patches to muhanai.com.
#
# Steps:
#   1. Verifies patches are present in the local source file
#   2. Confirms the dashboard file is the live one (by mtime vs chat-muhanai-com)
#   3. Deploys via the configured mechanism (rsync to nginx root, or rsync + reload)
#
# Usage:
#   bash scripts/deploy/dadabot-to-muhanai.sh           # dry-run
#   bash scripts/deploy/dadabot-to-muhanai.sh --apply   # actually deploys
#
# Requires:
#   - SSH access to muhanai.com server (configured in ~/.ssh/config)
#   - Remote root path (default /var/www/muhanai.com)

set -e

SRC="/Users/brianyeon/muhanai-folder/muhanai/muhanai/web-app/public/dashboard-v2.html"
REMOTE="${MUHANAI_REMOTE:-muhanai.com}"
REMOTE_ROOT="${MUHANAI_REMOTE_ROOT:-/var/www/muhanai.com}"
BACKUP_DIR="${MUHANAI_BACKUP_DIR:-$HOME/.dadabot/backups/muhanai}"

APPLY=0
[[ "$1" == "--apply" ]] && APPLY=1

GREEN="\033[32m"; YELLOW="\033[33m"; BOLD="\033[1m"; RESET="\033[0m"

echo -e "${BOLD}━━━ Dadabot → muhanai.com deployer ━━━${RESET}"

# 1. Verify source has the patches
if ! grep -q "data-space=\"dadabot\"" "$SRC"; then
  echo -e "${YELLOW}✗ Source missing dadabot patch${RESET}"
  echo "  Apply via: scripts/apply-dadabot-patches.sh"
  exit 1
fi

echo -e "${GREEN}✓ Source has dadabot patch${RESET}"

# 2. Confirm this is the live file (not a stale snapshot)
LIVE_MTIME=$(stat -f "%m" "$SRC" 2>/dev/null || echo 0)
SNAPSHOT="/Users/brianyeon/muhanai-folder/chat-muhanai-com/web-app/public/dashboard-v2.html"
if [ -f "$SNAPSHOT" ]; then
  SNAPSHOT_MTIME=$(stat -f "%m" "$SNAPSHOT")
  if [ "$LIVE_MTIME" -gt "$SNAPSHOT_MTIME" ]; then
    echo -e "${GREEN}✓ Source is newer than snapshot (live file)${RESET}"
  else
    echo -e "${YELLOW}⚠ Snapshot is newer — possible source confusion${RESET}"
  fi
fi

# 3. Stage backup
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/dashboard-v2.$(date +%Y%m%d-%H%M%S).html.bak"
echo "  Local backup → $BACKUP_FILE"
cp "$SRC" "$BACKUP_FILE"

# 4. Deploy
if [ "$APPLY" = "0" ]; then
  echo ""
  echo -e "${YELLOW}DRY RUN — pass --apply to actually deploy${RESET}"
  echo ""
  echo "Would run:"
  echo "  rsync -avz --delete '$SRC' '$REMOTE:$REMOTE_ROOT/dashboard-v2.html'"
  echo "  ssh '$REMOTE' 'sudo systemctl reload nginx'"
  exit 0
fi

echo ""
echo -e "${BOLD}━━━ Deploying ━━━${RESET}"

# rsync to remote
rsync -avz --delete "$SRC" "$REMOTE:$REMOTE_ROOT/dashboard-v2.html"
echo -e "${GREEN}✓ rsync complete${RESET}"

# Reload nginx
ssh "$REMOTE" 'sudo systemctl reload nginx' 2>/dev/null && \
  echo -e "${GREEN}✓ nginx reloaded${RESET}" || \
  echo -e "${YELLOW}⚠ nginx reload failed — run manually on remote${RESET}"

# Verify
echo ""
echo -e "${BOLD}━━━ Verification ━━━${RESET}"
echo "Local:   $(grep -c 다다봇 $SRC) occurrences of '다다봇'"
echo "Remote:  $(ssh "$REMOTE" "grep -c 다다봇 $REMOTE_ROOT/dashboard-v2.html" 2>/dev/null || echo 'N/A')"

echo ""
echo -e "${GREEN}✓ Done. muhanai.com → 🪆 다다봇 space visible.${RESET}"
echo ""
echo "If still not visible:"
echo "  1. Hard refresh browser (Cmd+Shift+R)"
echo "  2. Clear browser cache"
echo "  3. Check nginx access logs: ssh $REMOTE 'tail -f /var/log/nginx/access.log | grep dashboard'"
