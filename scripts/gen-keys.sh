#!/usr/bin/env bash
# gen-keys.sh — Generate minisign key pair for DadaBot release signing
# Usage: ./gen-keys.sh [output_dir]
# Creates: minisign.pub (public) + minisign.key (private, keep secret!)

set -euo pipefail

OUT_DIR="${1:-/Users/brianyeon/CodeGPT/integration-finalize/scripts/install/dadabot/release}"

echo "Generating minisign key pair..."
echo "Output directory: $OUT_DIR"

# Check if minisign is available
if ! command -v minisign &> /dev/null; then
    echo "minisign not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install minisign
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt &> /dev/null; then
            sudo apt update && sudo apt install -y minisign
        elif command -v pacman &> /dev/null; then
            sudo pacman -S minisign
        else
            echo "Please install minisign manually: https://jedisct1.github.io/minisign/"
            exit 1
        fi
    else
        echo "Unsupported OS. Please install minisign manually."
        exit 1
    fi
fi

# Generate key pair
echo "Generating key pair..."
minisign -G -p "$OUT_DIR/minisign.pub" -s "$OUT_DIR/minisign.key"

echo ""
echo "✅ Key pair generated!"
echo "  Public key:  $OUT_DIR/minisign.pub"
echo "  Private key: $OUT_DIR/minisign.key"
echo ""
echo "⚠️  IMPORTANT: Keep the private key secure!"
echo "   - Add to GitHub secrets: MINISIGN_KEY (contents of minisign.key)"
echo "   - Add to GitHub secrets: MINISIGN_PASSPHRASE (your passphrase)"
echo "   - Commit minisign.pub to repo (already in .gitignore for minisign.key)"
echo ""
echo "Public key:"
cat "$OUT_DIR/minisign.pub"

# Test signing
echo ""
echo "Testing signature..."
TEST_FILE="/tmp/test-sign.txt"
echo "test content" > "$TEST_FILE"
minisign -S -s "$OUT_DIR/minisign.key" -m "$TEST_FILE" -c "Test signature"
minisign -V -p "$OUT_DIR/minisign.pub" -m "$TEST_FILE"
echo "✅ Signature verification successful!"
rm -f "$TEST_FILE" "$TEST_FILE.sig"