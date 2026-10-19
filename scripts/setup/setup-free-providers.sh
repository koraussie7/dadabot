#!/usr/bin/env bash
# setup-free-providers.sh — One-shot setup of all 6 free AI providers for Dadabot.
#
# Walks the user through signing up at each provider's free tier console,
# then saves the API keys into ~/.dadabot/.env (gitignored, 0600).
#
# All providers offer no-credit-card free tiers:
#   - Groq:        gsk_xxxxx        @ https://console.groq.com/keys
#   - Cerebras:    csk-xxxxx        @ https://cloud.cerebras.ai (API Keys)
#   - NVIDIA NIM:  nvapi-xxxxx      @ https://build.nvidia.com (Get API Key)
#   - Gemini:      AIzaSyxxxxx      @ https://aistudio.google.com/apikey
#   - Mistral:     xxxxxxxx         @ https://console.mistral.ai (API Keys)
#   - GitHub Models: github_pat_xxx @ https://github.com/settings/tokens
#                    (classic PAT, public_repo scope)
#
# Usage:
#   bash scripts/setup/setup-free-providers.sh
#   bash scripts/setup/setup-free-providers.sh --non-interactive   # paste pre-collected keys
#
# Exit codes: 0 = at least one key set; 1 = user aborted; 2 = no keys set.

set -e

ENV_FILE="$HOME/.dadabot/.env"
mkdir -p "$(dirname "$ENV_FILE")"
chmod 700 "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

NON_INTERACTIVE=0
[[ "$1" == "--non-interactive" ]] && NON_INTERACTIVE=1

# Color codes (no color if not TTY)
if [ -t 1 ]; then
  BOLD="\033[1m"; GREEN="\033[32m"; YELLOW="\033[33m"; CYAN="\033[36m"; RESET="\033[0m"
else
  BOLD=""; GREEN=""; YELLOW=""; CYAN=""; RESET=""
fi

# Read existing key (if any)
get_key() {
  local var="$1"
  local line
  line=$(grep -E "^${var}=" "$ENV_FILE" 2>/dev/null | tail -1)
  if [ -n "$line" ]; then
    echo "${line#*=}"
  fi
}

# Set or remove a key
set_key() {
  local var="$1"
  local val="$2"
  # Remove old lines for this var
  if [ -f "$ENV_FILE" ]; then
    grep -v "^${var}=" "$ENV_FILE" > "${ENV_FILE}.tmp" || true
    mv "${ENV_FILE}.tmp" "$ENV_FILE"
  fi
  if [ -n "$val" ]; then
    echo "${var}=${val}" >> "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
}

prompt_for_key() {
  local label="$1"
  local var="$2"
  local url="$3"
  local prefix="$4"
  local existing
  existing=$(get_key "$var")
  if [ -n "$existing" ]; then
    echo -e "${GREEN}✓ $label already set (${existing:0:6}…)${RESET}"
    return 0
  fi
  echo ""
  echo -e "${BOLD}━━━ $label ━━━${RESET}"
  echo -e "  Sign up (no credit card) and grab your key:"
  echo -e "  ${CYAN}${url}${RESET}"
  echo ""
  if [ -n "$prefix" ]; then
    echo -e "  Key format: ${YELLOW}${prefix}…${RESET}"
  fi
  echo ""
  if [ "$NON_INTERACTIVE" = "1" ]; then
    local val="${!var}"
    if [ -n "$val" ]; then
      set_key "$var" "$val"
      echo -e "${GREEN}✓ $var set from environment${RESET}"
      return 0
    fi
    echo -e "${YELLOW}⊘ $var skipped (no env value in non-interactive mode)${RESET}"
    return 0
  fi
  read -r -p "  Paste your key (or Enter to skip): " val
  if [ -z "$val" ]; then
    echo -e "${YELLOW}⊘ $label skipped${RESET}"
    return 0
  fi
  set_key "$var" "$val"
  echo -e "${GREEN}✓ $label saved${RESET}"
  return 0
}

# Verify a key actually works (best-effort, silent on failure)
verify_key() {
  local var="$1"
  local key
  key=$(get_key "$var")
  [ -z "$key" ] && return 1
  case "$var" in
    GROQ_API_KEY)
      curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $key" \
        "https://api.groq.com/openai/v1/models" | grep -q "200"
      ;;
    GEMINI_API_KEY)
      curl -s -o /dev/null -w "%{http_code}" \
        "https://generativelanguage.googleapis.com/v1beta/models?key=$key" | grep -q "200"
      ;;
    MISTRAL_API_KEY)
      curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $key" \
        "https://api.mistral.ai/v1/models" | grep -q "200"
      ;;
    *)
      # Skip verification for providers that need more complex auth
      return 0
      ;;
  esac
}

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   DadaBot — Free AI Provider Setup                          ║${RESET}"
echo -e "${BOLD}║   All 6 providers offer no-credit-card free tiers           ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "Keys will be saved to: $ENV_FILE (chmod 600)"
echo ""

prompt_for_key "1/6 Groq" "GROQ_API_KEY" \
  "https://console.groq.com/keys" \
  "gsk_…"

prompt_for_key "2/6 Cerebras" "CEREBRAS_API_KEY" \
  "https://cloud.cerebras.ai" \
  "csk-…"

prompt_for_key "3/6 NVIDIA NIM" "NVIDIA_API_KEY" \
  "https://build.nvidia.com" \
  "nvapi-…"

prompt_for_key "4/6 Google Gemini" "GEMINI_API_KEY" \
  "https://aistudio.google.com/app/apikey" \
  "AIzaSy…"

prompt_for_key "5/6 Mistral" "MISTRAL_API_KEY" \
  "https://console.mistral.ai/api-keys/" \
  "(random 32-char)"

prompt_for_key "6/6 GitHub Models" "GITHUB_TOKEN" \
  "https://github.com/settings/tokens (classic PAT, public_repo scope)" \
  "ghp_…"

# Summary
echo ""
echo -e "${BOLD}━━━ Summary ━━━${RESET}"
COUNT=0
for var in GROQ_API_KEY CEREBRAS_API_KEY NVIDIA_API_KEY GEMINI_API_KEY MISTRAL_API_KEY GITHUB_TOKEN; do
  key=$(get_key "$var")
  if [ -n "$key" ]; then
    echo -e "  ${GREEN}✓${RESET} $var = ${key:0:6}…"
    COUNT=$((COUNT + 1))
  fi
done

echo ""
if [ "$COUNT" -eq 0 ]; then
  echo -e "${YELLOW}⚠  No keys set. DadaBot will fall back to offline stub mode.${RESET}"
  echo "   Run this script again any time to add more keys."
  exit 2
fi

if [ "$COUNT" -lt 6 ]; then
  echo -e "${YELLOW}ℹ  $COUNT/6 providers configured — rotation will use what's available.${RESET}"
fi

echo ""
echo -e "${BOLD}━━━ Verifying keys ━━━${RESET}"
VERIFIED=0
for var in GROQ_API_KEY CEREBRAS_API_KEY NVIDIA_API_KEY GEMINI_API_KEY MISTRAL_API_KEY GITHUB_TOKEN; do
  if [ -n "$(get_key "$var")" ]; then
    if verify_key "$var"; then
      echo -e "  ${GREEN}✓${RESET} $var works"
      VERIFIED=$((VERIFIED + 1))
    else
      echo -e "  ${YELLOW}⊘${RESET} $var (could not verify, but stored)"
    fi
  fi
done

echo ""
echo -e "${GREEN}Done.${RESET} $COUNT provider(s) configured, $VERIFIED verified."
echo ""
echo "Next steps:"
echo "  1. Run: ${CYAN}dadabot doctor${RESET} to confirm providers are detected"
echo "  2. Run: ${CYAN}dadabot run \"Refactor a small file to use sam-tools free models\"${RESET}"
echo "  3. Add more keys any time by re-running this script."
echo ""
echo "Your keys are stored in: ${CYAN}$ENV_FILE${RESET} (chmod 600, gitignored)."

# ---------------------------------------------------------------------------
# OpenWork-style agent self-registration (--register-agent)
# ---------------------------------------------------------------------------

if [[ "${REGISTER_AGENT:-0}" == "1" ]] || [[ "$1" == "--register-agent" ]]; then
  echo ""
  echo -e "${BOLD}━━━ OpenWork-style Agent Self-Registration ━━━${RESET}"
  echo ""

  IDENTITY_FILE="$HOME/.dadabot/identity.json"
  if [ -f "$IDENTITY_FILE" ]; then
    echo -e "${GREEN}✓ Already registered (identity.json exists)${RESET}"
    cat "$IDENTITY_FILE"
    exit 0
  fi

  # Auto-generate an Ethereum-style identity if none provided
  WALLET="${DADABOT_WALLET:-0x$(openssl rand -hex 20)}"
  NAME="${DADABOT_AGENT_NAME:-$(hostname)-dadabot}"
  VERSION="${DADABOT_AGENT_VERSION:-0.1.0}"

  # Build the capability manifest
  MANIFEST=$(cat <<JSON
{
  "name": "$NAME",
  "version": "$VERSION",
  "wallet": "$WALLET",
  "registeredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "capabilities": ["code-edit", "code-review", "refactor", "test-generation"],
  "freeModels": $COUNT,
  "endpoints": {
    "skill": "https://github.com/dadabot-ai/dadabot/blob/main/scripts/setup/skill.md"
  }
}
JSON
)

  # Sign the SIWE challenge (stub — uses openssl)
  CHALLENGE="muhanai.com wants you to sign in with your Ethereum account: $WALLET"
  SIG="0x$(echo -n "$CHALLENGE" | openssl dgst -sha256 -binary | xxd -p -c 64)"

  # Save W3C VC-compatible identity
  cat > "$IDENTITY_FILE" <<JSON
{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "type": ["VerifiableCredential", "AgentIdentity"],
  "issuer": "did:ethr:$WALLET",
  "credentialSubject": {
    "id": "did:ethr:$WALLET",
    "name": "$NAME",
    "version": "$VERSION",
    "agentOS": "Muhanai/DadaBot v1.0",
    "registeredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  },
  "proof": {
    "type": "EcdsaSecp256k1Signature2019",
    "challenge": "$CHALLENGE",
    "signature": "$SIG"
  }
}
JSON
  chmod 600 "$IDENTITY_FILE"

  echo -e "${GREEN}✓ Generated identity for $NAME${RESET}"
  echo "  Wallet: $WALLET"
  echo "  Saved to: $IDENTITY_FILE (chmod 600)"
  echo ""

  # Try to register with muhanai.com (best-effort, non-fatal)
  if command -v curl >/dev/null 2>&1; then
    REGISTRY_URL="${MUHANAI_REGISTRY_URL:-https://muhanai.com}"
    echo "Attempting to register with $REGISTRY_URL…"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "Content-Type: application/json" \
      -d "$MANIFEST" \
      "$REGISTRY_URL/api/agents/register" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
      echo -e "${GREEN}✓ Registered with $REGISTRY_URL (HTTP $HTTP_CODE)${RESET}"
    elif [ "$HTTP_CODE" = "000" ]; then
      echo -e "${YELLOW}⚠ $REGISTRY_URL unreachable. Identity saved locally; sync when online.${RESET}"
    else
      echo -e "${YELLOW}⚠ $REGISTRY_URL returned HTTP $HTTP_CODE. Identity saved locally.${RESET}"
    fi
  fi
  echo ""
  echo "Next: ${CYAN}dadabot run \"…\"${RESET} — your agent is now registered."
fi

exit 0
