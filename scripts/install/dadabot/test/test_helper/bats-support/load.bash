#!/usr/bin/env bash
# Minimal bats-support implementation for our tests

# Assertions
assert_success() {
    if [ "$status" -ne 0 ]; then
        echo "Expected success (exit 0), got exit $status"
        echo "Output: $output"
        return 1
    fi
    return 0
}

assert_failure() {
    if [ "$status" -eq 0 ]; then
        echo "Expected failure (non-zero exit), got exit 0"
        echo "Output: $output"
        return 1
    fi
    return 0
}

assert_output() {
    local expected="$1"
    if [[ "$output" != *"$expected"* ]]; then
        echo "Expected output to contain: $expected"
        echo "Actual output: $output"
        return 1
    fi
    return 0
}

assert_output --partial() {
    local expected="$1"
    if [[ "$output" != *"$expected"* ]]; then
        echo "Expected output to contain: $expected"
        echo "Actual output: $output"
        return 1
    fi
    return 0
}

assert_line() {
    local expected="$1"
    if ! echo "$output" | grep -q "$expected"; then
        echo "Expected line: $expected"
        echo "Actual output: $output"
        return 1
    fi
    return 0
}

# Run a command and capture output/status
run() {
    output=$("$@" 2>&1)
    status=$?
}

# skip and skip_if functions
skip() {
    echo "SKIP: $1"
    exit 0
}

skip_if() {
    if eval "$1"; then
        echo "SKIP: $2"
        exit 0
    fi
}