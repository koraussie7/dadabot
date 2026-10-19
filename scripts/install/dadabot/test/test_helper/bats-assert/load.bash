#!/usr/bin/env bash
# Minimal bats-assert implementation

assert_success() {
    if [ "$status" -ne 0 ]; then
        echo "Expected success (exit 0), got exit $status" >&2
        echo "Output: $output" >&2
        return 1
    fi
}

assert_failure() {
    if [ "$status" -eq 0 ]; then
        echo "Expected failure (non-zero exit), got exit 0" >&2
        echo "Output: $output" >&2
        return 1
    fi
}

assert_output() {
    local expected="$1"
    if [[ "$output" != *"$expected"* ]]; then
        echo "Expected output to contain: $expected" >&2
        echo "Actual output: $output" >&2
        return 1
    fi
}

assert_output --partial() {
    local expected="$1"
    if [[ "$output" != *"$expected"* ]]; then
        echo "Expected output to contain: $expected" >&2
        echo "Actual output: $output" >&2
        return 1
    fi
}

assert_output --regex() {
    local pattern="$1"
    if ! [[ "$output" =~ $pattern ]]; then
        echo "Expected output to match regex: $pattern" >&2
        echo "Actual output: $output" >&2
        return 1
    fi
}

assert_line() {
    local expected="$1"
    if ! echo "$output" | grep -qF "$expected"; then
        echo "Expected line: $expected" >&2
        echo "Actual output: $output" >&2
        return 1
    fi
}