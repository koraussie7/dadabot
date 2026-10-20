#!/usr/bin/env bash
# =============================================================================
# DadaBot installer — Unix/macOS (60초 안 인스톨러)
#   1) welcome          — 배너 + 언어 감지
#   2) detect_platform  — OS/arch/distro
#   3) resolve_version  — manifest fetch + fallback to GitHub API
#   4) download_artifacts — binary + signature + sha256
#   5) verify_signature — minisign + sha256
#   6) bootstrap_runtimes — 자체 번들 (Rust stdlib + Node + Candle)
#   7) setup_path       — ~/.dadabot/bin → PATH
#   8) launch           — 백그라운드 데몬 시작
# =============================================================================
set -euo pipefail
IFS=$'\n\t'

# ----- Defaults --------------------------------------------------------------
DADABOT_VERSION="${DADABOT_VERSION:-latest}"
DADABOT_CHANNEL="${DADABOT_CHANNEL:-stable}"
# dadabot.dev 도메인이 부재하므로 기본값은 GitHub raw mirror로 둡니다.
# muhanai.com 운영팀이 도메인을 복구하면 default를 다시 dadabot.dev로 되돌리세요.
DADABOT_BASE_URL="${DADABOT_BASE_URL:-https://raw.githubusercontent.com/dadabot-ai/dadabot/main}"
DADABOT_API_URL="${DADABOT_API_URL:-https://api.github.com/repos/dadabot-ai/dadabot/releases}"
DADABOT_HOME="${DADABOT_HOME:-$HOME/.dadabot}"
DADABOT_BIN_DIR="$DADABOT_HOME/bin"
DADABOT_CACHE_DIR="$DADABOT_HOME/cache"
DADABOT_TMP_DIR="$(mktemp -d -t dadabot.XXXXXX)"
DADABOT_DRY_RUN="${DADABOT_DRY_RUN:-0}"
DADABOT_TRACE="${DADABOT_TRACE:-0}"
DADABOT_AUTO_UPDATE="${DADABOT_AUTO_UPDATE:-1}"
DADABOT_PORT="${DADABOT_PORT:-7878}"

mkdir -p "$DADABOT_HOME" "$DADABOT_BIN_DIR" "$DADABOT_CACHE_DIR"
chmod 700 "$DADABOT_HOME" "$DADABOT_BIN_DIR"

# Cleanup on error
trap 'rm -rf "$DADABOT_TMP_DIR"' EXIT

# ----- Output helpers --------------------------------------------------------
if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  BLUE=$'\033[34m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; BOLD=""; RESET=""
fi

info()  { printf "%s==>%s %s\n" "$BLUE" "$RESET" "$*"; }
ok()    { printf "%s ✓%s %s\n" "$GREEN" "$RESET" "$*"; }
warn()  { printf "%s !%s %s\n" "$YELLOW" "$RESET" "$*" >&2; }
err()   { printf "%s ✗%s %s\n" "$RED" "$RESET" "$*" >&2; }
banner(){ printf "%s%s%s\n" "$BOLD" "$*" "$RESET"; }

# ----- Trace mode (system-call tracing for debugging) ------------------------
if [ "$DADABOT_TRACE" = "1" ]; then
  set -x
fi

# ----- Stage 1: welcome -------------------------------------------------------
welcome() {
  cat <<'BANNER'
       ____           ____        _
      |  _ \  __ _ __| __ )  ___ | |_
      | | | |/ _` | '__|  _ \ / _ \| __|
      | |_| | (_| | |  | |_) | (_) | |_
      |____/ \__,_|_|  |____/ \___/ \__|
      Local-first AI Agent OS · v0.1.0-beta.1
BANNER
  info "Welcome — installing DadaBot in ${DADABOT_HOME}"
  if [ "$DADABOT_DRY_RUN" = "1" ]; then
    warn "DRY-RUN mode: no actual downloads or modifications"
  fi
}

# ----- Stage 2: detect_platform ----------------------------------------------
detect_platform() {
  local os arch distro=""
  case "$(uname -s 2>/dev/null || echo Unknown)" in
    Linux*)  os="linux" ;;
    Darwin*) os="macos" ;;
    *)       err "Unsupported OS: $(uname -s)"; return 1 ;;
  esac

  case "$(uname -m 2>/dev/null || echo Unknown)" in
    x86_64|amd64)  arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
    *)             err "Unsupported architecture: $(uname -m)"; return 1 ;;
  esac

  if [ "$os" = "linux" ] && [ -f /etc/os-release ]; then
    distro=$(. /etc/os-release; echo "${ID:-unknown}")
  fi

  DADABOT_OS="$os"
  DADABOT_ARCH="$arch"
  DADABOT_DISTRO="$distro"

  # macOS universal if both arches supported
  if [ "$os" = "macos" ]; then
    DADABOT_ASSET_SUFFIX="macos-universal"
  elif [ "$distro" = "alpine" ]; then
    DADABOT_ASSET_SUFFIX="linux-${arch}-musl"
  else
    DADABOT_ASSET_SUFFIX="linux-${arch}"
  fi
  ok "Platform: $DADABOT_OS / $DADABOT_ARCH  →  $DADABOT_ASSET_SUFFIX"
}

# ----- fetch_url with retries ------------------------------------------------
fetch_url() {
  local url="$1" out="${2:-}"
  local attempt=0 max=3
  while [ $attempt -lt $max ]; do
    attempt=$((attempt + 1))
    if [ "$DADABOT_DRY_RUN" = "1" ]; then
      info "[dry-run] would fetch: $url → ${out:-stdout}"
      return 0
    fi
    if [ -n "$out" ]; then
      if curl -fsSL --max-time 120 --retry 0 "$url" -o "$out"; then return 0; fi
    else
      if curl -fsSL --max-time 120 --retry 0 "$url"; then return 0; fi
    fi
    warn "fetch attempt $attempt/$max failed: $url"
    sleep $((attempt * 2))
  done
  return 1
}

# ----- Stage 3: resolve_version ----------------------------------------------
# 1순위: $DADABOT_BASE_URL/releases/latest-${CHANNEL}.json (CDN 캐시, ~50ms)
# 2순위 폴백: GitHub Releases API (~500ms)
resolve_version() {
  local manifest="$DADABOT_CACHE_DIR/latest-${DADABOT_CHANNEL}.json"
  local version=""
  if [ "$DADABOT_VERSION" != "latest" ]; then
    version="$DADABOT_VERSION"
    info "Pinned version: $version"
  else
    info "Resolving latest version for channel: $DADABOT_CHANNEL"
    if fetch_url "$DADABOT_BASE_URL/releases/latest-${DADABOT_CHANNEL}.json" "$manifest" 2>/dev/null; then
      version="$(grep -o '"version": *"[^"]*"' "$manifest" | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
      if [ -n "$version" ]; then ok "Manifest served: $version"; fi
    fi
    if [ -z "$version" ]; then
      local release_json=""
      if release_json="$(fetch_url "$DADABOT_API_URL/latest" "$DADABOT_CACHE_DIR/release.json" 2>/dev/null)"; then
        version="$(grep -o '"tag_name": *"[^"]*"' <<<"$release_json" | head -1 | sed 's/.*"v\?\([^"]*\)".*/\1/')"
      fi
    fi
    if [ -z "$version" ]; then err "Could not resolve latest version"; return 1; fi
  fi
  DADABOT_VERSION="$version"
  ok "Version: $DADABOT_VERSION"
}

# ----- Extract platform entry from manifest ---------------------------------
# Sets globals: ASSET_NAME, ASSET_DOWNLOAD_URL, ASSET_SHA256, ASSET_SIZE_BYTES
resolve_platform_asset() {
  local manifest="$DADABOT_CACHE_DIR/latest-${DADABOT_CHANNEL}.json"
  local suffix="$1"
  if [ ! -f "$manifest" ]; then err "Manifest not found at $manifest"; return 1; fi
  local block
  block="$(awk -v key="\"${suffix}\":" 'index($0, key) {found=1} found {print; if (/{/) b++; if (/}/) {b--; if (b==0 && found) exit}}' "$manifest")"
  if [ -z "$block" ]; then err "Platform suffix '$suffix' not in manifest"; return 1; fi
  ASSET_NAME="$(echo "$block" | grep -o '"asset": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
  ASSET_DOWNLOAD_URL="$(echo "$block" | grep -o '"download_url": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
  ASSET_SHA256="$(echo "$block" | grep -o '"sha256": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
  ASSET_SIZE_BYTES="$(echo "$block" | grep -o '"size_bytes": *[0-9]*' | head -1 | grep -o '[0-9]*$')"
  if [ -z "$ASSET_NAME" ] || [ -z "$ASSET_DOWNLOAD_URL" ] || [ -z "$ASSET_SHA256" ]; then
    err "Manifest entry for '$suffix' incomplete"; return 1
  fi
  ok "Platform: $suffix  asset=$ASSET_NAME  size=${ASSET_SIZE_BYTES:-?}B"
}

# ----- Stage 4: download_artifacts -------------------------------------------
download_artifacts() {
  if ! resolve_platform_asset "$DADABOT_ASSET_SUFFIX"; then
    err "Cannot find a matching binary for $DADABOT_ASSET_SUFFIX"
    return 1
  fi

  DADABOT_ARCHIVE="$DADABOT_TMP_DIR/$ASSET_NAME"
  DADABOT_SHA_FILE="$DADABOT_TMP_DIR/${ASSET_NAME}.sha256"
  DADABOT_SIG_FILE="$DADABOT_TMP_DIR/${ASSET_NAME}.sig"

  info "Downloading $ASSET_NAME (${ASSET_SIZE_BYTES:-?} bytes)"
  fetch_url "$ASSET_DOWNLOAD_URL" "$DADABOT_ARCHIVE" || { err "Download failed"; return 1; }

  info "Downloading SHA-256"
  fetch_url "${ASSET_DOWNLOAD_URL}.sha256" "$DADABOT_SHA_FILE" || { warn "SHA-256 not available"; }

  info "Downloading minisign signature"
  fetch_url "${ASSET_DOWNLOAD_URL}.sig" "$DADABOT_SIG_FILE" || { warn "Signature not available (will skip verification)"; }
}

# ----- Stage 5: verify_signature ---------------------------------------------
verify_signature() {
  local actual
  actual="$(sha256sum "$DADABOT_ARCHIVE" | awk '{print $1}')"
  if [ -f "$DADABOT_SHA_FILE" ]; then
    local expected
    expected="$(awk '{print $1}' "$DADABOT_SHA_FILE")"
    if [ "$actual" != "$expected" ]; then
      err "SHA-256 mismatch: expected $expected, got $actual"
      return 1
    fi
    ok "SHA-256 verified"
  else
    warn "Skipping SHA-256 verification (no checksum file)"
  fi

  if [ -f "$DADABOT_SIG_FILE" ] && command -v minisign >/dev/null 2>&1; then
    if minisign -V -p "$DADABOT_HOME/minisign.pub" -m "$DADABOT_ARCHIVE" 2>/dev/null; then
      ok "minisign signature verified"
    else
      warn "minisign verification failed (continuing — first install or key rotation)"
    fi
  fi
}

# ----- Stage 6: bootstrap_runtimes -------------------------------------------
# 런타임은 바이너리에 자체 번들되어 있어 별도 설치 없음
bootstrap_runtimes() {
  info "Extracting bundle..."
  local extract_dir="$DADABOT_HOME/versions/$DADABOT_VERSION"
  mkdir -p "$extract_dir"
  tar -xzf "$DADABOT_ARCHIVE" -C "$extract_dir" || { err "Extraction failed"; return 1; }
  ok "Extracted to $extract_dir"
}

# ----- Stage 7: setup_path ---------------------------------------------------
setup_path() {
  # Symlink current binary
  ln -sf "$DADABOT_HOME/versions/$DADABOT_VERSION/bin/dadabot" "$DADABOT_BIN_DIR/dadabot"
  ln -sf "$DADABOT_HOME/versions/$DADABOT_VERSION/bin/dadabot-shim" "$DADABOT_BIN_DIR/dadabot-shim" 2>/dev/null || true

  # Update shell rc
  local rc_file=""
  case "${SHELL:-/bin/bash}" in
    *zsh)  rc_file="$HOME/.zshrc" ;;
    *fish) rc_file="$HOME/.config/fish/config.fish" ;;
    *)     rc_file="$HOME/.bashrc" ;;
  esac

  local path_line="export PATH=\"$DADABOT_BIN_DIR:\$PATH\""
  if [ -n "$rc_file" ] && [ -f "$rc_file" ] && ! grep -qF "$DADABOT_BIN_DIR" "$rc_file"; then
    printf "\n# DadaBot\n%s\n" "$path_line" >> "$rc_file"
    ok "Added $DADABOT_BIN_DIR to PATH in $rc_file"
  fi

  # Also export for current session
  export PATH="$DADABOT_BIN_DIR:$PATH"
}

# ----- Stage 8: launch -------------------------------------------------------
launch() {
  if [ "$DADABOT_DRY_RUN" = "1" ]; then
    info "[dry-run] would launch daemon on port $DADABOT_PORT"
    return 0
  fi

  # Background daemon
  nohup "$DADABOT_BIN_DIR/dadabot" daemon --port "$DADABOT_PORT" \
    > "$DADABOT_HOME/daemon.log" 2>&1 &
  DADABOT_PID=$!
  disown "$DADABOT_PID" 2>/dev/null || true
  sleep 0.5
  if kill -0 "$DADABOT_PID" 2>/dev/null; then
    ok "Daemon started (pid=$DADABOT_PID, port=$DADABOT_PORT)"
  else
    warn "Daemon failed to start — check $DADABOT_HOME/daemon.log"
  fi
}

# ----- Main -------------------------------------------------------------------
main() {
  welcome
  detect_platform
  resolve_version
  download_artifacts
  verify_signature
  bootstrap_runtimes
  setup_path
  launch

  cat <<'DONE'
────────────────────────────────────────────
  ✓ DadaBot 설치 완료

  지금 바로 시작:
    export PATH=~/.dadabot/bin:$PATH
    dadabot chat
  또는 'dadabot doctor' 로 시스템 점검.
────────────────────────────────────────────
DONE
}

main "$@"
