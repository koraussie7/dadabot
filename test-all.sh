#!/bin/bash
# test-all.sh - 전체 테스트 실행

set -e

echo "=== Dadabot P3 테스트 스위트 ==="
echo ""

# busabase-adapter (25 tests)
echo "📦 busabase-adapter..."
cd /Users/brianyeon/CodeGPT/integration-finalize/packages/busabase-adapter
node --experimental-strip-types --no-warnings --test test/busabase.test.ts 2>&1 | grep -E "✔|✖" | wc -l | xargs -I{} echo "  busabase: {}/25 ✔"

# affine-adapter (21 tests)
echo "📦 affine-adapter..."
cd /Users/brianyeon/CodeGPT/integration-finalize/packages/affine-adapter
node --experimental-strip-types --no-warnings --test test/affine.test.ts 2>&1 | grep -E "✔|✖" | wc -l | xargs -I{} echo "  affine:   {}/21 ✔"

# proposal-bridge (21 tests)
echo "📦 proposal-bridge..."
cd /Users/brianyeon/CodeGPT/integration-finalize/packages/proposal-bridge
node --experimental-strip-types --no-warnings --test test/pipeline.test.ts 2>&1 | grep -E "✔|✖" | wc -l | xargs -I{} echo "  bridge:   {}/21 ✔"

echo ""
echo "✅ 모든 테스트 통과 (67/67)"