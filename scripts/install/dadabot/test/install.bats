#!/usr/bin/env bats
# install.bats — BATS test suite for install.sh
# Run: bats test/install.bats

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

INSTALL_SCRIPT="/Users/brianyeon/CodeGPT/integration-finalize/scripts/install/dadabot/install.sh"
MOCK_DIR="/tmp/dadabot-test-$$"
ORIGINAL_HOME="$HOME"
ORIGINAL_PATH="$PATH"

setup() {
    export HOME="$MOCK_DIR"
    export PATH="$MOCK_DIR/bin:$PATH"
    mkdir -p "$MOCK_DIR/bin"
    mkdir -p "$MOCK_DIR/.dadabot/bin"
    mkdir -p "$MOCK_DIR/.local/bin"
    # Mock curl to return test manifest
    cat > "$MOCK_DIR/bin/curl" << 'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"latest-stable.json"* ]]; then
    cat << 'EOF'
{
  "channel": "stable",
  "version": "0.1.0-test",
  "published_at": "2026-10-19T00:00:00Z",
  "minisign_pubkey": "RWQqHXfRYzE7kBvK1Lm8Np2Qs5Tv4Wx9Yz6A3F7G0Bc2D5E8H1J4M6N9P1R3S5T7V",
  "platforms": {
    "linux-x86_64": {
      "display_name": "Linux (x86_64 GNU)",
      "asset": "dadabot-0.1.0-test-linux-x86_64.tar.gz",
      "download_url": "file:///tmp/dadabot-mock-assets/dadabot-0.1.0-test-linux-x86_64.tar.gz",
      "signature_url": "file:///tmp/dadabot-mock-assets/dadabot-0.1.0-test-linux-x86_64.tar.gz.sig",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "size_bytes": 1024
    }
  }
}
EOF
    exit 0
fi
echo "Mock curl: $*" >&2
exit 1
EOF
    chmod +x "$MOCK_DIR/bin/curl"
    
    # Mock sha256sum
    cat > "$MOCK_DIR/bin/sha256sum" << 'EOF'
#!/usr/bin/env bash
echo "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  $2"
EOF
    chmod +x "$MOCK_DIR/bin/sha256sum"
    
    # Mock minisign
    cat > "$MOCK_DIR/bin/minisign" << 'EOF'
#!/usr/bin/env bash
if [[ "$1" == "-V" ]]; then
    echo "Signature verified"
    exit 0
fi
if [[ "$1" == "-S" ]]; then
    touch "${10}.sig"
    exit 0
fi
exit 1
EOF
    chmod +x "$MOCK_DIR/bin/minisign"
    
    # Mock tar
    cat > "$MOCK_DIR/bin/tar" << 'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"-czf"* ]]; then
    # Create a mock archive
    mkdir -p dadabot-bundle/bin
    echo "#!/bin/sh\necho 'dadabot test binary'" > dadabot-bundle/bin/dadabot
    chmod +x dadabot-bundle/bin/dadabot
    touch "$3"
    exit 0
fi
if [[ "$*" == *"-xzf"* ]]; then
    mkdir -p dadabot-bundle/bin
    echo '#!/bin/sh\necho "dadabot test binary"' > dadabot-bundle/bin/dadabot
    chmod +x dadabot-bundle/bin/dadabot
    exit 0
fi
exit 1
EOF
    chmod +x "$MOCK_DIR/bin/tar"
    
    # Mock grep for version detection
    cat > "$MOCK_DIR/bin/grep" << 'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"v0.1.0"* ]]; then
    echo "v0.1.0-test"
    exit 0
fi
command grep "$@"
EOF
    chmod +x "$MOCK_DIR/bin/grep"
    
    # Mock uname for platform detection
    cat > "$MOCK_DIR/bin/uname" << 'EOF'
#!/usr/bin/env bash
if [[ "$1" == "-s" ]]; then
    echo "Linux"
elif [[ "$1" == "-m" ]]; then
    echo "x86_64"
fi
EOF
    chmod +x "$MOCK_DIR/bin/uname"
    
    # Mock arch
    cat > "$MOCK_DIR/bin/arch" << 'EOF'
#!/usr/bin/env bash
echo "x86_64"
EOF
    chmod +x "$MOCK_DIR/bin/arch"
}

teardown() {
    rm -rf "$MOCK_DIR"
    export HOME="$ORIGINAL_HOME"
    export PATH="$ORIGINAL_PATH"
}

@test "install.sh --help shows usage" {
    run bash "$INSTALL_SCRIPT" --help
    assert_success
    assert_output --partial "Usage"
    assert_output --partial "dadabot"
}

@test "install.sh --dry-run downloads manifest" {
    export DADABOT_CHANNEL="stable"
    export DADABOT_DRY_RUN=1
    run bash "$INSTALL_SCRIPT" --dry-run
    assert_success
    assert_output --partial "latest-stable.json"
}

@test "install.sh --dry-run --channel=beta uses beta channel" {
    export DADABOT_CHANNEL="beta"
    export DADABOT_DRY_RUN=1
    run bash "$INSTALL_SCRIPT" --dry-run
    assert_success
    assert_output --partial "latest-beta.json"
}

@test "install.sh --dry-run --channel=nightly uses nightly channel" {
    export DADABOT_CHANNEL="nightly"
    export DADABOT_DRY_RUN=1
    run bash "$INSTALL_SCRIPT" --dry-run
    assert_success
    assert_output --partial "latest-nightly.json"
}

@test "install.sh rejects invalid channel" {
    export DADABOT_CHANNEL="invalid"
    export DADABOT_DRY_RUN=1
    run bash "$INSTALL_SCRIPT" --dry-run
    assert_failure
    assert_output --partial "invalid channel"
}

@test "install.sh creates ~/.dadabot/bin in PATH" {
    export DADABOT_DRY_RUN=1
    run bash "$INSTALL_SCRIPT" --dry-run
    assert_success
    assert_output --partial ".dadabot/bin"
}

@test "install.sh detects Linux x86_64" {
    export DADABOT_DRY_RUN=1
    run bash "$INSTALL_SCRIPT" --dry-run
    assert_success
    assert_output --partial "linux-x86_64"
}

@test "install.sh --version prints version" {
    run bash "$INSTALL_SCRIPT" --version
    assert_success
    assert_output --partial "0.1.0"
}