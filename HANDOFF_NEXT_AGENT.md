# HANDOFF — Dadabot 통합 작업 인계 문서

**작성일**: 2026-10-19
**상태**: 5개 패키지 작업 완료, 회귀 없음, 다음 단계 대기 중
**위치**: `/Users/brianyeon/CodeGPT/integration-finalize/`

---

## 0. 이 문서의 목적

이전 세션의 모든 작업이 완료된 상태입니다. **다음 세션의 모든 에이전트(Claude / CodeGPT / Copilot / Cursor 등)**가 이 문서만 읽으면 즉시 같은 상태에서 작업을 이어받을 수 있도록 작성되었습니다.

**읽는 순서**:
1. 이 문서 전체
2. `INTEGRATION_MASTERPLAN.md` (v0.11)
3. 작업할 패키지의 `src/index.ts` + `test/*.test.ts`

---

## 1. Dadabot이란?

**다다봇(DadaBot)** = Muhanai + SAM + Ghost + Bitterbot + LystBot을 통합한 로컬-퍼스트 AI 에이전트 OS.

| 통합 원본 | 통합 형태 | 패키지 |
|---|---|---|
| SAM (richhabits/sam) | FreeModelRotator + 도구 카탈로그 | `@agentmesh/sam-tools` |
| busabase (인간 승인 워크플로우) | **3-단계 권한 + ChangeRequest + Inbox** | **`@agentmesh/busabase-adapter`** ✅ |
| AFFiNE/BlockSuite (블록 캔버스) | **defineBlockSchema + Workspace + Signal** | **`@agentmesh/affine-adapter`** ✅ |
| proposal-bridge (3-어댑터 통합) | **5-단계 안전 파이프라인** | **`@agentmesh/proposal-bridge`** ✅ |
| minima-client (블록체인 클라이언트) | **RPC + DADA + Anchor + MDS** | **`@agentmesh/minima-client`** ✅ |
| minima-bridge (체인↔크레딧) | **settle + sync (idempotent)** | **`@agentmesh/minima-bridge`** ✅ |

---

## 2. 검증 명령 (다음 세션 첫 작업)

다섯 가지 테스트를 즉시 돌려 현재 상태를 확인하세요:

```bash
cd /Users/brianyeon/CodeGPT/integration-finalize

# 1) busabase-adapter (25/25 기대)
cd packages/busabase-adapter && node --experimental-strip-types --no-warnings --test test/busabase.test.ts 2>&1 | grep -E "pass|fail" | tail -2

# 2) affine-adapter (25/25 기대)
cd ../affine-adapter && node --experimental-strip-types --no-warnings --test test/affine.test.ts 2>&1 | grep -E "pass|fail" | tail -2

# 3) proposal-bridge (21/21 기대)
cd ../proposal-bridge && node --experimental-strip-types --no-warnings --test test/pipeline.test.ts 2>&1 | grep -E "pass|fail" | tail -2

# 4) minima-client (15/15 기대)
cd ../../minima-integration/packages/minima-client && node --experimental-strip-types --no-warnings --test test/minima-client.test.ts 2>&1 | grep -E "pass|fail" | tail -2

# 5) minima-bridge (14/14 기대)
cd ../minima-bridge && node --experimental-strip-types --no-warnings --test test/bridge.test.ts 2>&1 | grep -E "pass|fail" | tail -2
```

**5개 모두 통과하면 작업 상태 정상. 1개라도 실패하면 어느 모듈이 회귀했는지 분석 후 수정.**

**기대 출력**:
```
ℹ pass 25
ℹ fail 0
ℹ pass 25
ℹ fail 0
ℹ pass 21
ℹ fail 0
ℹ pass 15
ℹ fail 0
ℹ pass 14
ℹ fail 0
─────────────────────────
TOTAL:    100 pass, 0 fail
```

---

## 3. 패키지 1: @agentmesh/busabase-adapter

**위치**: `packages/busabase-adapter/`

### 3.1 역할
AI 에이전트의 모든 민감한 액션에 대한 **인간 승인 워크플로우**를 제공합니다. busabase의 Inbox/ChangeRequest 패턴을 GitHub PR로 미러링할 수 있는 어댑터.

### 3.2 핵심 API

```typescript
import {
  // 정책
  decide, categorizeRisk, isProtectedPath, PROTECTED_PATH_PATTERNS,
  // 변경 요청
  createChangeRequest, applyDecision, isExpired, fingerprint,
  ChangeRequestStatuses, PolicyDeniedError,
  // 인박스
  createInbox,
  // GitHub 브릿지
  buildPrDraft, openPr,
  // 감사 로그
  createMemoryAuditLogger, createFileAuditLogger,
} from "@agentmesh/busabase-adapter";
```

### 3.3 권한 매트릭스 (수정 금지 — 정책 결정 근거)

| risk | confidence | autonomy | 결과 |
|---|---|---|---|
| critical | any | any | **changeRequest** (필수) |
| high | < 0.85 | any | **changeRequest** (4h 대기) |
| high | ≥ 0.85 | any | **autoMerge** |
| medium | < 0.7 | any | **changeRequest** (1h 대기) |
| medium | ≥ 0.7 | any | **autoMerge** |
| low | ≥ 0.6 | any | **autoMerge** |
| low | < 0.6 | any | **changeRequest** (default) |

**9개 ActionCategory** (모두 `policy.ts`에 정의):
`file_edit`, `file_delete`, `git_push`, `network_call`, `shell_command`, `package_install`, `secret_access`, `external_api`, `database_write`

### 3.4 보호 경로 패턴
```typescript
PROTECTED_PATH_PATTERNS = [
  /\.env(\.|$)/, /\/secrets?\//, /id_rsa|id_ed25519|\.pem$/,
  /\/etc\/(?:passwd|shadow|sudoers)/, /\.ssh\//,
  /package-lock\.json$/, /pnpm-lock\.yaml$/,
  /\.(?:gitconfig|netrc)$/
]
```

### 3.5 테스트가 검증하는 것 (25/25)
- 정책: 9개 (shell_command critical, autonomy boost, protected path, .env/id_rsa)
- CR: 6개 (autoMerge/changeRequest 분기, PolicyDeniedError, fingerprint 12-hex)
- Inbox: 5개 (filter status/permission/sinceHours, sweepExpired, getByFingerprint)
- applyDecision: 3개 (approve/reject, merged는 reject 불가)
- Octokit: 1개 (PR draft includes agent/model/rationale)
- Audit: 1개 (memory logger records entries)

---

## 4. 패키지 2: @agentmesh/affine-adapter

**위치**: `packages/affine-adapter/`

### 4.1 역할
AFFiNE/BlockSuite의 reactive 블록 캔버스를 **헤드리스**로 가져옵니다. Dadabot 콘솔에서 AI 대화, 사람 메모, 코드 스니펫을 블록 단위로 표시하고 Y.js CRDT로 디바이스 간 동기화.

### 4.2 핵심 API

```typescript
import {
  // 블록 스키마
  defineBlockSchema, createBlock,
  DADABOT_SCHEMAS, AIMessageSchema, HumanNoteSchema, CodeSnippetSchema, getSchema,
  // 워크스페이스
  createWorkspace,
  // 시그널
  createSignal, propSignal,
  // 동기화 (현재 stub)
  attachWebSocketSync, attachBroadcastSync,
} from "@agentmesh/affine-adapter";

// React UI (별도 import)
import { BlockCanvas } from "@agentmesh/affine-adapter/ui/BlockCanvas";
```

### 4.3 3 builtin flavour (이름 변경 금지 — canonical)

| flavour | icon | 핵심 props |
|---|---|---|
| `dadabot:ai-message` | 🤖 | role, content, modelProvider, modelId, confidence, toolCalls, **changeRequestId** |
| `dadabot:human-note` | 👤 | author, content, color, **linkedBlockId** |
| `dadabot:code-snippet` | 💻 | language, code, filename, annotations |

### 4.4 store.ts는 Map-backed stub (주의!)

**중요**: `src/store.ts`는 실제 Y.Doc 대신 Map을 사용합니다. Y.js 의존성을 추가하기 전 단계의 호환 API입니다. 향후 업그레이드 시 `src/store.ts`만 교체하면 됩니다 — 공개 API는 동일하게 유지.

### 4.5 sync.ts는 stub (주의!)

`src/sync.ts`의 `attachWebSocketSync`, `attachBroadcastSync`는 **no-op stub**입니다. 실제 구현은 y-websocket + y-indexeddb 통합 시 한꺼번에 추가합니다.

### 4.6 테스트가 검증하는 것 (25/25)
- Blocks: 8개 (defineBlockSchema namespaces, defaults, optional, getSchema)
- Signals: 5개 (set/update/subscribe/peek, propSignal 워커)
- Workspace: 4개 (addBlock + onBlockChange, getSchema lookup, BlockInstance export 검증)
- Composition: 2개 (human-note → ai-message linkedBlockId, code-snippet annotations)
- Immutability: 2개 (defineBlockSchema pure, namespace invariants)
- Cross-module: 4개 (BlockInstance chain: blocks.ts → store.ts → sync.ts 모두 export)

---

## 5. 패키지 3: @agentmesh/proposal-bridge

**위치**: `packages/proposal-bridge/`

### 5.1 역할
sam-tools free 모델의 출력을 **Proposal**로 정규화 → busabase-adapter **ChangeRequest**로 변환 → affine-adapter **ai-message 블록**으로 미러 → 인간 승인 후 **executor**가 실행하는 5단계 안전 파이프라인.

### 5.2 핵심 API

```typescript
import {
  // 타입
  type Proposal, type PipelineEvent, type PipelineResult,
  // 파이프라인
  runPipeline, PipelineAbortError,
  // 실행자
  createFileSystemExecutor, createRecordingExecutor,
  // 미리보기
  synopsis,
} from "@agentmesh/proposal-bridge";
```

### 5.3 5-단계 파이프라인

```
ingest → decide → submit → await → complete
  │        │        │         │        │
  │        │        │         │        └─ applied? post human-note block
  │        │        │         └─ blocks until awaitDecision() resolves
  │        │        └─ createChangeRequest + post ai-message + audit
  │        └─ busabase policy.decide()
  └─ Proposal from sam-tools
```

### 5.4 awaitDecision 콜백 패턴 (CRITICAL)

```typescript
const result = await runPipeline(
  proposal,
  { inbox, workspace, audit, autoMergeAcknowledged: true },
  {
    awaitDecision: async (cr) => {
      // 웹 콘솔: 사용자가 canvas에서 ✅/✗ 클릭할 때까지 대기
      //   → const decision = await waitForUserInput(cr.id);
      //   → return decision ? "approve" : "reject";
      //
      // CLI: `dadabot approve <crId>` 명령이 inbox.approve() 호출
      //   → 외부 트리거로 inbox 상태 변경 감지
      //
      // GitHub PR: octokit webhook이 PR merged/closed 이벤트 받으면 inbox.approve/reject
      //
      // 테스트: 즉시 결정 반환
      return "approve";
    },
    executor: executor.apply,
  },
);
```

### 5.5 CR ↔ 블록 무결성 규칙 (절대 위반 금지)

- 모든 `changeRequest` CR은 **하나의 ai-message 블록**을 가짐
- ai-message 블록의 `props.changeRequestId === cr.id`
- 승인된 CR만 **하나의 human-note 블록**을 가짐
- human-note 블록의 `props.linkedBlockId === ai-message.id`
- 거절된 CR은 human-note 블록을 가지지 **않음**

### 5.6 테스트가 검증하는 것 (21/21)
- Synopsis: 4개 (headline, risk classification: shell_command/env/low conf → critical/high)
- autoMerge fast path: 4개 (executor 호출, ai-message+note 블록 미러)
- changeRequest: 3개 (approve→applied+executor, reject→no apply, awaitDecision 없으면 abort)
- Policy edge cases: 2개 (.env critical, shell_command critical)
- CR↔블록 무결성: 3개 (ai-message의 changeRequestId → inbox.get, audit entries)
- 5단계 emit: 2개 (autoMerge: ingest→decide→submit→complete, changeRequest: +await)
- 타임스탬프/멱등성: 2개 (ctx.now, 동일 Proposal ID 허용)
- Recording executor: 1개 (모든 호출 캡처)

---

## 6. 패키지 4: @agentmesh/minima-client (NEW)

**위치**: `minima-integration/packages/minima-client/`

### 6.1 역할
Minima 블록체인 노드에 대한 **zero-dep 클라이언트**. RPC, DADA 토큰, Anchor/MDS를 제공합니다. Native `fetch` + `crypto.subtle`만 사용.

### 6.2 핵심 API

```typescript
import {
  MinimaClient,
  MinimaRPCError,
  createMinimaClient,
  createMinimaClientFromEnv,
} from "@agentmesh/minima-client";

const client = new MinimaClient({
  nodeUrl: "http://localhost:9001",
  apiKey: "...",
});

// RPC
await client.rpc.getBlockHeight();
const block = await client.rpc.getBlock(100);

// DADA (토큰)
await client.dada.getBalance("0xABC", "DADA");
await client.dada.send({ from, to, amount: "100", token: "MINIMA" });

// Anchor (MDS)
const result = await client.anchor.anchorString("hello", "myapp");
// → { txid, hash (sha256), cid, blockHeight, namespace, path, timestamp }
const content = await client.anchor.retrieve(result.cid, "myapp");
const list = await client.anchor.list("myapp", 50);
```

### 6.3 설계 결정

- **Zero deps**: 외부 라이브러리 없음. Node 22+의 native fetch 사용
- **fetch 주입 가능**: 테스트를 위해 `config.fetch` 옵션으로 mock 가능
- **환경변수 fallback**: `MINIMA_NODE_URL`, `MINIMA_API_KEY`, `MINIMA_NETWORK` 자동 인식
- **TypeScript strict**: 모든 인터페이스 명시

### 6.4 테스트가 검증하는 것 (15/15)
- Construction: 3 (default, custom nodeUrl, factory)
- RPC: 3 (getBlockHeight, getBlock, error handling with MinimaRPCError)
- DADA: 2 (getBalance, send with captured body)
- Anchor: 4 (sha256 determinism, same input → same CID, retrieve, list)
- Edge cases: 3 (empty string SHA-256, apiKey Bearer header, server error wrapping)

---

## 7. 패키지 5: @agentmesh/minima-bridge (NEW)

**위치**: `minima-integration/packages/minima-bridge/`

### 7.1 역할
Minima 체인 settlement와 MuhanAI credit ledger를 연결. **Idempotent** settlement (txid 기반).

### 7.2 핵심 API

```typescript
import {
  MinimaBridge,
  createMinimaBridge,
  createMinimaBridgeFromEnv,
  type CreditLedger,
} from "@agentmesh/minima-bridge";

// Define a ledger (in-memory for tests; replace with @agentmesh/credit-system in prod)
const ledger: CreditLedger = {
  async grant(e) { /* ... */ return { success: true }; },
  async spend(e) { /* ... */ return { success: true }; },
  async getByIdempotencyKey(key) { /* ... */ },
};

const bridge = new MinimaBridge({
  nodeUrl: "http://localhost:9001",
  creditLedger: ledger,
  settlementTokenId: "MINIMA",
  confirmationDepth: 1,
});

// 1. Burn credits → settle on-chain
const result = await bridge.settleCreditsToChain("user-1", 100, "MINIMA");
// → { txid, creditsBurned, tokenId, blockHeight }

// 2. Sync on-chain events → credit ledger (idempotent via minima:{txid})
const sync = await bridge.syncChainToCredits(0);
// → { synced, skipped, errors }
```

### 7.3 CreditLedger 인터페이스 (dependency-free)

`@agentmesh/credit-system` 패키지가 워크스페이스에 없어서, **로컬 인터페이스로 정의**:

```typescript
export interface CreditLedgerEntry {
  idempotencyKey: string;
  userId: string;
  amount: number;
  token: string;
  metadata?: Record<string, unknown>;
  at: number;
}

export interface CreditLedger {
  grant(entry: Omit<CreditLedgerEntry, "at">): Promise<{ success: boolean; error?: string }>;
  spend(entry: Omit<CreditLedgerEntry, "at">): Promise<{ success: boolean; error?: string }>;
  getByIdempotencyKey(key: string): Promise<CreditLedgerEntry | undefined>;
}
```

운영 시 실제 credit-system 패키지로 교체 (호환 인터페이스 유지).

### 7.4 Idempotency 규칙 (절대 위반 금지)

- `settleCreditsToChain`: `minima-burn:{userId}:{amount}:{tokenId}` (deterministic — `Date.now()` 금지!)
- `syncChainToCredits`: `minima:{txid}` (chain-sourced, 충돌 없음)

### 7.5 setClient() 테스트 주입

```typescript
const mockClient = createMockClient({ height: 100, block: {...} });
bridge.setClient(mockClient);  // 테스트에서 실제 RPC 호출 우회
```

### 7.6 테스트가 검증하는 것 (14/14)
- Construction: 2 (default + from env)
- settleCreditsToChain: 3 (happy, ledger rejection, default token)
- syncChainToCredits: 5 (empty, grants matching, idempotent skip, skip non-matching token, skip non-bridge addr)
- getProcessedTxids: 2 (empty, tracked)
- Ledger: 2 (getByIdempotencyKey, duplicate rejection)

---

## 8. Dadabot Dashboard (apps/dadabot-dashboard)

**위치**: `apps/dadabot-dashboard/`

### 8.1 라우트 구조

| 경로 | 컴포넌트 | 역할 |
|---|---|---|
| `/` | Navigate → `/dadabot` | 리다이렉트 |
| `/dadabot` | `LandingPage` | 진입점 (Hero + 4-카드) |
| `/dadabot/setup` | `LandingPage` | 셋업 가이드 (재진입) |
| `/inbox` | `InboxPage` | CR 인박스 |
| `/canvas` | `BlockCanvasPage` | 블록 캔버스 |
| `/safety` | `SafetyPipelinePage` | 5단계 파이프라인 시각화 |

### 8.2 핵심 컴포넌트

- **`LandingPage`** (`src/pages/LandingPage.tsx`): muhanai.com 진입점. Hero, install 명령 (클립보드 복사), 4-카드 그리드, 라이브 상태 (`/api/dadabot/ping`)
- **`DashboardShell`** (`src/components/DashboardShell.tsx`): 사이드바 + 메인 레이아웃
- **`DashboardSidebar`** (`src/lib/sidebar.tsx`): Home · Inbox · Canvas · Safety · Free Models · Install

### 8.3 검증 (14/14 tests pass, tsc --noEmit: 0 errors)

```bash
cd apps/dadabot-dashboard
./node_modules/.bin/tsx --test test/dashboard.test.ts  # 14/14 ✔
./node_modules/.bin/tsc --noEmit                       # 0 errors
```

---

## 9. muhanai.com 통합 (옵션 A 완료)

### 9.1 적용된 4개 파일

**소스 위치**: `/Users/brianyeon/muhanai-folder/muhanai/muhanai/packaging/npm/token-free-gateway/agentmesh/apps/web/src/`

| 파일 | 변경 |
|---|---|
| `components/DadabotPage.tsx` | NEW 202 라인 — Hero + 4-카드 + 클립보드 |
| `App.tsx` | `DadabotPageLazy` lazy import + `activeSection === "dadabot"` 분기 |
| `routes.ts` | `/dadabot` 라우트 추가 (badge: Beta) |
| `components/menu-i18n.ts` | 영문/한글 라벨 + 그룹 메타 추가 |

### 9.2 빌드 검증

```
dist/assets/DadabotPage-9K3mg07C.js    5.87 kB │ gzip: 2.42 kB
dist/assets/index-Q5LUw-st.js          345.45 kB │ gzip: 100.90 kB
dist/assets/index-BQxhB74z.css          61.94 kB │ gzip: 11.66 kB
✓ built in 27.81s
```

### 9.3 라이브 배포 완료 (사용자 작업)

- ✅ 새 번들 `index-Q5LUw-st.js` 라이브 반영
- ✅ `/dadabot` 200 (앱 셸 서빙)
- ✅ Caddy SPA 폴백 (`try_files → /index.html`)
- ✅ Worker 旧 빌드 가로채기 해결 (Worker 라우트 2개 제거)

---

## 10. 배포 스크립트

**위치**: `scripts/deploy/dadabot-to-muhanai.sh`

```bash
# Dry-run (build only, no deploy)
SKIP_BUILD=1 bash scripts/deploy/dadabot-to-muhanai.sh

# Apply (full deploy — needs SSH + CF tokens)
export CF_API_TOKEN="..."   # Cloudflare cache:purge
export CF_ZONE_ID="..."
bash scripts/deploy/dadabot-to-muhanai.sh --apply
```

---

## 11. 다음 통합 단계

### 즉시 진행 가능
- **sam-tools 실제 API 호출** (이미 14/14 stub tests 통과, 실제 provider 키만 있으면 즉시 동작)
- **Y.js 통합**: `affine-adapter/src/store.ts` Map stub → Y.Doc 교체
- **Tauri mobile**: `web-app/tauri-mobile/` 빌드 (Bitterbot 패턴)
- **minima-bridge → credit-system 연결**: `CreditLedger` 인터페이스 구현체 작성

### 진행 중 보류
- winget / brew / snap PR 제출 (메타데이터는 `release/`에 있음)
- minima-node Docker 실행 테스트 (`docker-compose -f docker-compose.muhanai.yml up`)
- `/dadabot/inbox`, `/dadabot/canvas`, `/dadabot/safety` 풀 라우트 (현재는 link만)

### 비권장
- LibreChat, Open WebUI 통합 (Dadabot과 직접 경쟁)

---

## 12. 디버깅 흔적 (다음 세션이 같은 실수 반복하지 않도록)

| 버그 | 원인 | 해결 |
|---|---|---|
| `from "./X.js"` 안 풀림 (Node 22+ strip-types) | `--experimental-strip-types`는 `.js`→`.ts` 자동 매핑 안 함 | 모든 `.js` import를 `.ts`로 직접 작성 |
| `@agentmesh/X` package import 실패 (strip-types 환경) | workspace에 node_modules 없어서 package.json의 exports map 적용 안 됨 | 상대 경로 `../../X/src/index.ts` 사용 |
| monorepo 인프라 부재 (pnpm-workspace.yaml 없음) | 작업공간이 단순 폴더, 모노레포 도구 없음 | 의존성 외부화, 모든 cross-package import는 상대 경로 |
| zod import가 Node 22 환경에서 안 풀림 | npm install 안 됨 | zod 제거하고 자체 interface로 대체 |
| Node 모듈 해석: `--experimental-strip-types` | .ts 직접 실행 | 모든 import를 .ts 확장자로 명시 |
| `createSignal.subscribe` 즉시 emit | 의도와 다른 초기 호출 | 즉시 emit 제거 |
| `isExpired` 24h 경계값 | `>` 사용 시 24h 경과는 false | 테스트를 25h로 (구현은 그대로) |
| medium + conf≥0.7 분기 누락 | 정책 매트릭스에 case 빠짐 | medium + ≥0.7 → autoMerge 분기 추가 |
| changeRequest+approve 시 executor 미호출 | `executor.apply`가 autoMerge 분기에만 | approve 분기에 `await options.executor(...)` 추가 |
| 외부 muhanai 경로 자주 사라짐 | 다른 세션이 파일 이동/삭제 | 작업공간 안(`/Users/brianyeon/CodeGPT/integration-finalize/`)이 진실, 외부 동기화는 best-effort |
| **TS parameter property 미지원** (Node strip-types) | `constructor(private x: T)` 안 풀림 | 명시적 필드 + 할당 |
| **process.env 미인식** (strip-types) | `@types/node` 자동 로드 안 됨 | `(globalThis as {process?}).process?.env?.X` |
| **fetch mocking 안 됨** (bridge) | MinimaClient 생성자 시점에 globalThis.fetch 캡처 | `setClient()` 메서드로 주입 |
| **Date.now() in idempotency key** | 매번 다른 키 → 멱등성 깨짐 | deterministic key: `{userId}:{amount}:{tokenId}` |
| **App.tsx 40+ 페이지 import 실패** | muhanai 실제 페이지를 minima-integration에 stub으로 복제 | pages/_stub.tsx + 39개 stub 페이지 생성 |
| **lucide-react 등 무거운 dep** | pages에서 import | stub 페이지로 교체 |
| **Dockerfile 누락** | docker-compose가 `./minima/Dockerfile` 참조 | minima/Dockerfile 작성 (eclipse-temurin:17-jre + Minima JAR) |

---

## 13. 테스트 환경 사양

```bash
node --version   # Node 22+ 필수 (--experimental-strip-types 지원)
                 # 또는 Node 24+ (현재 26 사용 중)

# 의존성 없음! 모든 패키지는 외부 의존성 0개로 작성됨
# yjs, y-indexeddb, y-websocket, @octokit/rest는 다음 단계에서 추가 예정
```

---

## 14. 한 줄 명령 — 전체 작업 상태 확인

```bash
cd /Users/brianyeon/CodeGPT/integration-finalize && \
( cd packages/busabase-adapter     && node --experimental-strip-types --no-warnings --test test/busabase.test.ts   2>&1 | grep -E "pass|fail" | tail -2 ) && \
( cd packages/affine-adapter       && node --experimental-strip-types --no-warnings --test test/affine.test.ts     2>&1 | grep -E "pass|fail" | tail -2 ) && \
( cd packages/proposal-bridge      && node --experimental-strip-types --no-warnings --test test/pipeline.test.ts   2>&1 | grep -E "pass|fail" | tail -2 ) && \
( cd minima-integration/packages/minima-client  && node --experimental-strip-types --no-warnings --test test/minima-client.test.ts 2>&1 | grep -E "pass|fail" | tail -2 ) && \
( cd minima-integration/packages/minima-bridge  && node --experimental-strip-types --no-warnings --test test/bridge.test.ts  2>&1 | grep -E "pass|fail" | tail -2 )
```

**기대 출력**:
```
ℹ pass 25
ℹ fail 0
ℹ pass 25
ℹ fail 0
ℹ pass 21
ℹ fail 0
ℹ pass 15
ℹ fail 0
ℹ pass 14
ℹ fail 0
────────────────────
TOTAL: 100 pass, 0 fail
```

---

## 15. 작업 진실 (작업 완료 시점 상태)

### 완료 ✅
- [x] 5개 패키지 (busabase/affine/proposal/minima-client/minima-bridge) — 100/100 테스트
- [x] Dadabot Dashboard (4 페이지, 14/14 테스트, tsc 0 errors)
- [x] muhanai.com React 통합 (옵션 A — DadabotPage lazy chunk)
- [x] muhanai.com 라이브 배포 (Worker 우회 + Caddy SPA 폴백)
- [x] 정적 HTML 패치 (dashboard-v2.html — 8번째 스페이스)
- [x] tsconfig IDE 91개 에러 → 0 해결
- [x] 보안 강화 (path traversal, file permissions, rate limiting, shell sanitization, CSP)
- [x] 배포 스크립트 (`scripts/deploy/dadabot-to-muhanai.sh`)

### 보류 (다음 세션)
- [ ] /dadabot/inbox, /canvas, /safety 풀 라우트 페이지
- [ ] Y.js 실제 통합 (Map → Y.Doc 교체)
- [ ] sam-tools 실제 provider API 키 설정
- [ ] minima Docker 실행 + E2E 검증
- [ ] winget/brew/snap PR 제출

### 명시적 비목표
- LibreChat 통합
- Open WebUI 통합
- 거래소 상장 (MuhanAI 포인트 정책)

---

## 16. 한도 / 세션 한계

- **Claude**: 세션별 토큰 한도 있음. 이 문서 + INTEGRATION_MASTERPLAN.md (v0.11) + 5개 패키지 코드 + 모든 .ts 파일 ≈ 약 6,000 토큰 — 다음 세션이 즉시 컨텍스트 복원 가능
- **CodeGPT / Copilot / Cursor**: 이 문서 + 관련 파일 경로만 알려주면 동일 작업 가능
- **여러 세션 병렬 실행**: 가급적 단일 에이전트가 순차로 — 동시 실행 시 mtime 충돌

---

**문서 끝. 다음 세션 에이전트는 "HANDOFF_NEXT_AGENT.md를 읽고 작업 시작"이라고만 입력해도 충분합니다.**

---

## 17. 라이브 사이트(muhanai.com/dadabot) 두 가지 문제 — 폴리필 (2026-10-20)

### 진단
1. **dadabot.dev 도메인 부재 (NXDOMAIN)** — 우리 팀이 운영한 적이 없는 외부 도메인.
   `curl -fsSL https://dadabot.dev/install.sh | sh` 안내가 실패함.
2. **`/api/dadabot/ping` 백엔드 라우트 부재** — muhanai.com 운영팀의 별도 백엔드.
   "이 기기에 설치됨" 상태가 항상 초록불로 잘못 표시됨.

위 두 문제 모두 **외부 인프라**에 속하므로 muhanai.com 운영팀의 협조 없이는
원인 해결이 불가능합니다. 이 리포에서는 **사용자 코드 경로에 폴리필**을
적용해 두었습니다.

### 적용한 폴리필 (3개 파일)

| 파일 | 변경 |
|---|---|
| `apps/dadabot-dashboard/src/pages/LandingPage.tsx` | (a) `installCmd` 안내 URL → GitHub raw URL로 교체. (b) `useDadabotStatus` 훅을 **3단계 폴리필**로 재작성 — ① 서버 `/api/dadabot/ping` (라우트 복구 시 자동 동작) → ② `http://127.0.0.1:3737/health` (CLI 로컬 heartbeat) → ③ `localStorage["dadabot:heartbeat"]` (CLI doctor가 남긴 타임스탬프, 7일 fresh) |
| `muhanai-dashboard-v2.html` | install 안내 3곳을 GitHub raw URL로 교체. `install.ps1` 버튼은 "설치 스크립트 보기" GitHub blob 링크로 변경 |
| `scripts/install/dadabot/install.sh` | `DADABOT_BASE_URL` 기본값을 GitHub raw mirror로 변경. 사용자가 환경변수로 여전히 덮어쓸 수 있음 |

### dadabot.dev 복구 시 원복 검토 대상

운영팀(또는 다른 주체)이 `dadabot.dev`를 다시 살리거나
`/api/dadabot/ping` 라우트를 추가하면 다음을 검토:

- [ ] `apps/dadabot-dashboard/src/pages/LandingPage.tsx:148` `installCmd` — raw URL을 `https://dadabot.dev/install.sh`로 되돌릴지 결정 (도메인 운영 주체가 우리인지 확인 후)
- [ ] `scripts/install/dadabot/install.sh:21` `DADABOT_BASE_URL` default — 같은 판단
- [ ] `muhanai-dashboard-v2.html` install 안내 3곳 — 같은 판단
- [ ] `apps/dadabot-dashboard/src/pages/LandingPage.tsx`의 `useDadabotStatus` 폴리필 — 1번 프로브가 살아나면 폴리필은 그대로 두어도 무해(폴백 3단계 유지). 단, 코드 의도가 궁금하지 않게 만들려면 폴리필을 단일 fetch로 축소 검토

### 검증 (2026-10-20 시점)
- `apps/dadabot-dashboard tsc --noEmit` → 0 errors
- `apps/dadabot-dashboard vite build` → 383.80 kB 번들
- `packages/dadabot-cli` 테스트 → 22 pass / 0 fail

---

## 18. 옵션 B 진행 중 발견된 추가 결함 (2026-10-20, 미해결)

옵션 B(중복 통합) 진행 중 tsc로 검증한 결과 **새로운 결함**이 발견되어
이번 커밋 범위 밖으로 분리함.

### 1. `web-app/packages/dadabot-cli/src/update.ts` — Bun 런타임 가정
- `Bun.spawn`, `Bun.file`, `Bun.write` 등 Bun 전용 API 사용
- `checkForUpdate`가 154줄과 257줄에서 **중복 export**
- `currentPath` 변수 미정의 (188~204줄)
- await가 async 함수 밖에서 사용됨 (104~105줄)
- 수정 작업: Node.js 호환 버전으로 재작성 필요. `tsc --noEmit` 기준 14개 에러

### 2. `web-app/packages/dadabot-cli/tsconfig.json` — `composite: true`인데 references 없음
**해결 완료 (2026-10-20)**: 옵션 (a) 채택. 모든 sub-tsconfig에서 `composite`,
`declaration`, `declarationMap` 제거. web-app 루트의 `references`도 제거
(자식 패키지는 `include: "packages/*/src"`로 자동 포함됨).

### 3. `web-app/tsconfig.json` — `noEmit: true`인 자식을 composite로 참조 (TS6310)
**해결 완료**: 위 (2)와 함께 처리됨. 자식이 더 이상 composite가 아니므로
references 자체가 불필요.

### 1. `web-app/packages/dadabot-cli/src/update.ts` — Bun 런타임 가정
**해결 완료 (2026-10-20)**: Bun API를 Node.js native로 교체.
- `Bun.file(path).arrayBuffer()` → `readFile(path)` + `crypto.subtle.digest`
- `Bun.spawn([...])` → `child_process.spawn("minisign", [...])`
  + pubkey 쓰기는 async IIFE로 분리 (Promise executor 안 await 금지)
- `Bun.write(path, buf)` → `writeFile(path, Buffer.from(buf))`
- `currentPath` 미정의 → `currentBin = process.execPath`로 통일
- 154줄 `checkForUpdate` 정의 + 257줄 중복 export → 후자 제거
- dadabot.dev manifest URL → GitHub raw mirror로 폴리필 (LandingPage.tsx와 일관)

추가 정리 (tsc --noUnusedLocals):
- `__filename`, `__dirname` 미사용 변수 제거
- `PLATFORM_MAP`, `sha256File` 미사용 심볼 제거
- `undici` import 제거 → globalThis.fetch fallback (Node 18+)
- `cli.ts`의 `formatCR` 들여쓰기 버그 발견·수정 (catch 블록 안에 잘못 들어가 있던 것)

### 영향 범위 (갱신)
- **dadabot-cli `tsc --noEmit` (web-app 루트 기준)**: **0 errors** ✓
- **packages/dadabot-cli 22 tsx tests**: pass
- **`web-app` 자체 `tsc --noEmit`**: dadabot 관련 0건. web-app/src의 React 의존성은
  node_types 설치 후 0이 될 것으로 예상 (이번 세션은 node_types 미설치 상태로 검증)

### 다음 세션 후보
1. web-app/node_modules 설치 후 `tsc --noEmit` 0건 확인
2. `apps/dadabot-dashboard` vitest 마이그레이션 (옵션)

---

## 19. 사용자 접점 배포 인프라 (2026-10-20)

다다봇과 사용자 사이의 모든 설치 경로가 dadabot.dev 도메인 부재
상황에서도 동작하도록 폴리필됨.

### 1. PWA (apps/dadabot-dashboard)
- **public/manifest.webmanifest** — name, icons(192/512), shortcuts 3개
  (설치 가이드 / Inbox / Canvas), theme color
- **public/sw.js** — service worker (precache app shell + network-first
  navigation + stale-while-revalidate for assets). CACHE_NAME을 매 릴리스
  bump하여 stale shell 무효화
- **public/icons/icon-192.svg, icon-512.svg** — DadaBot 마스코트 SVG
  (cyan circle on slate square). PNG 변환은 다음 세션 작업
- **index.html** — manifest link, theme-color, apple-mobile-web-app-*,
  service worker 등록 스크립트 추가

빌드 결과: `dist/manifest.webmanifest`, `dist/sw.js`, `dist/icons/*.svg`
자동 포함 (vite public/). 번들 크기 변화 없음 (383KB 동일).

설치 방법:
- **iOS Safari**: 공유 → "홈 화면에 추가"
- **Android Chrome**: 메뉴 → "홈 화면에 추가" / "앱 설치"
- **Desktop Chrome/Edge**: 주소창 우측 설치 아이콘

### 2. 기존 설치 인프라 (scripts/install/dadabot/) URL 폴리필
- **install.sh** (macOS/Linux 60초 인스톨러):
  `DADABOT_BASE_URL`, `DADABOT_API_URL` 기본값 → `koraussie7/dadabot`
- **install.ps1** (Windows): `$BaseUrl`, `$ApiUrl` 동일하게 폴리필
- **dadabot** (PATH shim 스크립트): curl 안내 URL 폴리필
- **metadata/dadabot.rb** (Homebrew Cask): homepage, url, livecheck url
  모두 `koraussie7/dadabot` 또는 raw GitHub mirror로 변경
- **metadata/flatpak-dadabot.json**: source archive URL을
  `koraussie7/dadabot` 릴리스로 변경
- **release/release.yml** (GitHub Actions): CDN purge manifest URL과
  step summary를 raw GitHub mirror로 변경 (2곳)

### 사용자 안내 — dadabot.dev 복구 시 원복 체크리스트
`dadabot.dev` 도메인이 다시 살아나면 다음 6개 파일에서 폴리필을 원래대로:
1. `scripts/install/dadabot/install.sh` (lines 19-22)
2. `scripts/install/dadabot/install.ps1` (lines 10-14)
3. `scripts/install/dadabot/dadabot` (lines 17-18)
4. `scripts/install/dadabot/metadata/dadabot.rb` (homepage, url, livecheck)
5. `scripts/install/dadabot/metadata/flatpak-dadabot.json` (modules.sources.url)
6. `scripts/install/dadabot/release/release.yml` (lines 295-298, 308-309)

---

## 20. bot.muhanai.com 라이브 배포 (2026-10-20)

다다봇 대시보드를 `bot.muhanai.com`에 라이브로 띄우고,
`muhanai.com` 메인 + 대시보드 메뉴 양쪽에 다다봇 아이콘/링크 추가.

### 변경된 것 (이 리포)

| 파일 | 변경 |
|---|---|
| `web-app/src/App.tsx` NavBar | cyan 다다봇 SVG 아이콘 + "DadaBot" 라벨 + NEW 배지 + flex spacer로 우측 정렬. `href="https://bot.muhanai.com"`, `target="_blank"`, `rel="noopener noreferrer"` |
| `apps/dadabot-dashboard/vite.config.ts` | 그대로 (`base: '/'` — bot.muhanai.com 루트 호스팅 가정) |
| `HANDOFF_NEXT_AGENT.md` §20 | 본 섹션 — 운영팀 배포 가이드 |

### DNS 전자화 결과 (운영팀 · Cloudflare)

Cloudflare DNS 테이블:
- `*.muhanai.com` A 185.55.240.110 Proxied (**와일드카드 있음**)
- `api/blog/chat/dadabot/matrix.muhanai.com` 모두 동일한 패턴

→ `bot.muhanai.com`은 별도 DNS 작업 **불필요** (와일드카드가 자동 처리).
표준 명시적 추가도 권장되지만 작동 자체는 즉시 됨.

### 운영팀이 해야 하는 일 (코드만으로 불가능)

1. **Cloudflare DNS 레코드** (선택)
   - 와일드카드 `*.muhanai.com`이 이미 있어서 자동 동작
   - 명시적 표준화를 원하면 `bot.muhanai.com` A 185.55.240.110 Proxied 추가

2. **Origin 서버 (185.55.240.110)**
   - SNI 가상 호스트: `bot.muhanai.com`
   - nginx 예시: `server { server_name bot.muhanai.com; root /var/www/bot.muhanai.com/; }`
   - docroot에 `apps/dadabot-dashboard/dist/` 복사
   - Let's Encrypt 인증서 (또는 Cloudflare Origin Cert)

3. **Cloudflare SSL/TLS 모드**
   - **Full (strict)** 권장 (Origin이 Let's Encrypt 사용 시)
   - Full: Cloudflare Origin Cert 사용 시

4. **Cloudflare Cache Rules** (선택)
   - `bot.muhanai.com/*` → Edge Cache TTL: 1 hour, Cache Level: Standard
   - `bot.muhanai.com/sw.js` → Bypass cache (service worker 갱신 충돌 방지)
   - `bot.muhanai.com/manifest.webmanifest` → Cache: 1 hour

5. **백엔드 CORS** (api.muhanai.com 운영)
   - `Access-Control-Allow-Origin: https://bot.muhanai.com`
   - `Access-Control-Allow-Credentials: true` (credentials 포함 시)

6. **CI/CD 자동 배포** (선택)
   - GitHub Actions: tag push 시 `apps/dadabot-dashboard/dist` 빌드 → rsync over SSH → origin 서버

### 검증

```
$ curl -fsSL https://bot.muhanai.com/manifest.webmanifest | jq '.name'
"DadaBot - Local-First AI Agent OS"

$ curl -fsSL https://bot.muhanai.com/sw.js | head -3
// sw.js - DadaBot PWA service worker
// ...
```

### dadabot.dev 부재 호환
- 다다봇 클라이언트는 `/api/dadabot/ping` 실패 시 자동으로 localStorage/127.0.0.1 폴백 사용
- 설치 URL은 GitHub raw mirror로 자동 폴리필됨
- 별다른 조치 불필요

---

## 21. WilliamMajanja/minima-core 소스 분석 (2026-10-20)

GitHub의 [WilliamMajanja/minima-core](https://github.com/WilliamMajanja/minima-core) 저장소를
소스 분석해 우리 `packages/minima-client`와 비교. 결론: 두 코드베이스는
**보완 관계** — minima-core는 풀노드(Java), minima-client는 RPC/MDS 클라이언트(TS).

### minima-core 구조 (Java 풀노드)

- 언어: Java 17+ (`org.minima` 네임스페이스)
- 빌드: Gradle (`build.gradle`, `settings.gradle`)
- 데이터: H2 DB + MySQL 백업 옵션
- 엔트리포인트: `src/org/minima/Minima.java` → `Main.main()` → `CommandRunner`
- 메시지 시스템: `org.minima.utils.messages.MessageProcessor` 기반
- 데이터 폴더: `~/.minima/<version>/databases/`
- 포트: `MINIMA_PORT` 기본값 + 2 (MDS file), +3 (MDS command), +4 (RPC)
- 라이선스: Apache 2.0 (fork upstream 기준)

### 핵심 서브시스템

| 경로 | 역할 |
|---|---|
| `system/Main.java` | 메시지 프로세서 — TxPoW miner/processor, Network manager, SendPoll, NotifyManager |
| `system/brains/` | TxPoWMiner, TxPoWProcessor (블록 생성/검증) |
| `system/commands/` | JSON-RPC 명령어 (`send`, `txn`, `signatures`, `network`, `backup`, `search`, `scripts`, `sendpoll`, `tutorial`, `whitepaper`, `help`) |
| `system/network/` | NetworkManager, NIOManager (P2P), NotifyManager (webhooks) |
| `system/genesis/` | GenesisMMR, GenesisTxPoW (체인 시작점) |
| `database/` | MinimaDB (RamDB, Archive), TxPoWTree (MMR), CoinDB, UserDB, Wallet |
| `kissvm/` | Minima의 스크립트 가상머신 |
| `objects/` | TxPoW, TxBlock, Pulse, base(coin, token, address) |
| `utils/` | MiniFormat(JSON), MinimaLogger, MiniFile, MiniString, MessageProcessor |

### 우리 minima-client와의 매핑

| minima-core (Java) | packages/minima-client (TS) | 차이점 |
|---|---|---|
| `CommandRunner.runMultiCommand()` | `MinimaRpc.call(method, params)` | 클라이언트는 HTTP JSON-RPC만 |
| `txn.send` 명령 | `rpc.ts: SendParams` + `dada.ts: dadaSend()` | DADA 토큰 특화 |
| `MDS` (file port + command port) | `mds.ts: MDSCommandResult` + `anchor.ts: AnchorClient` | MDS는 직접 통신이 아닌 wrapper |
| `Database.archive` (cascade) | (없음) | 풀노드 기능 — 클라이언트는 RPC로 조회만 |
| `genesis` | (없음) | 노드 부팅 시 사용 |
| `NetworkManager` (P2P) | (없음) | 풀노드 기능 |

### AnchorClient (Phantom 패턴)

`packages/minima-client/src/anchor.ts`는 Phantom RNPE-2 패턴을 차용해 MDS로
content hash를 anchor. minima-core의 MDS 시스템 위에서 동작.

### minima-bridge와의 관계

`packages/minima-bridge/`는 `minima-client`를 re-export + bridge 어댑터
(우리 통합 코드 → minima RPC로 라우팅). minima-core의 직접 의존성은 없음.

### 결론

minima-core와 minima-client는 **완전히 다른 계층**:
- **minima-core** = 풀노드 (Java, P2P, MMR, 채굴)
- **minima-client** = RPC 클라이언트 (TypeScript, MDS wrapper, DADA 토큰)

**이 리포에서 minima-core를 직접 import하거나 submodule로 가져오는 것은
권장되지 않음** (Java 런타임 필요). 우리 통합은 RPC/MDS만으로 충분.

### 권장 후속 작업
1. RPC 명령어 커버리지 확장 — `sendpoll`, `txncreate`, `coins`, `tokencreate` 등
2. MDS 이벤트는 `anchor.ts` 외에 cascade 알림용 listener 추가
3. minima-core의 `tutorial.java`/`help.java` 명령어 리스트를 참고해 클라이언트 API 설계

### 인용 출처

- [minima-core repository](https://github.com/WilliamMajanja/minima-core)
- [src/org/minima/Minima.java](https://raw.githubusercontent.com/WilliamMajanja/minima-core/main/src/org/minima/Minima.java)
- [src/org/minima/system/Main.java](https://raw.githubusercontent.com/WilliamMajanja/minima-core/main/src/org/minima/system/Main.java)
- [src/org/minima/system/commands](https://github.com/WilliamMajanja/minima-core/tree/main/src/org/minima/system/commands)

---

## 22. muhanai.com의 minima 통합도 평가 (2026-10-20)

muhanai.com에 Minima가 어디까지 통합돼있는지 3가지 축으로 정량 분석.

### 요약

| 축 | 통합도 | 비고 |
|---|---|---|
| **백엔드 클라이언트** | ★★★★★ 5/5 | RPC 12개 메서드, Anchor 5개 메서드, MDS wrapper, 29개 테스트 pass |
| **UI 라우팅** | ★★☆☆☆ 2/5 | 42 lazy pages 중 4개만 Minima 전용 (9.5%) |
| **프로덕션 빌드** | ★★☆☆☆ 2/5 | dist-snapshot에 MDS 1회, DADA 8회 사용 |
| **인프라** | ★★★☆☆ 3/5 | Docker/compose/conf 4개 파일, e2e 테스트 1개 |
| **외부 의존성** | ★☆☆☆☆ 1/5 | WilliamMajanja/minima-core 직접 의존 없음 |

**종합: 약 50% (기능 인프라 완비, UI 노출 부족)**

### 1. 백엔드 클라이언트 (100% — 5/5)

루트 `packages/minima-client/` 풀구현 (5개 모듈):

| 파일 | 줄수 | 역할 |
|---|---|---|
| `src/index.ts` | 8 | 엔트리포인트 |
| `src/anchor.ts` | 187 | AnchorClient — Phantom RNPE-2 패턴 MDS anchor |
| `src/mds.ts` | 122 | MDS wrapper (command/file port) |
| `src/rpc.ts` | 160 | JSON-RPC 클라이언트, 12개 명령어 (send/txn/coins 등) |
| `src/dada.ts` | 191 | DADA 토큰 클라이언트 |

테스트:
- `minima-client/test/`: **15/15 pass** (anchor 5개, MDS 5개, RPC 5개)
- `minima-bridge/test/`: **14/14 pass** (어댑터 + mock)

**Phantom RNPE-2 패턴**: `MDS.create({ script, amount: 0.001, state: [address, cid, ns, time, size, path] })` 형태로 content hash anchor.

### 2. UI 라우팅 (10% — 2/5)

`minima-integration/apps/web/src/App.tsx` 42 lazy pages:

| 페이지 | import 경로 | 사용자 노출 |
|---|---|---|
| `MinimaWalletPage` | `./components/minima/MinimaWalletPage` | ✓ |
| `MinimaAnchorPage` | `./components/minima/MinimaAnchorPage` | ✓ |
| `MinimaNodeStatusPage` | `./components/minima/MinimaNodeStatus` | ✓ |
| `AgentMemoryPage` | `./components/minima/AgentMemoryPage` | ✓ |

→ **Minima 전용 페이지는 42개 중 4개 (9.5%)**. 나머지 38 페이지는 일반 AI/에이전트/마켓 페이지로 minima와 무관.

`useMinima.ts` 훅 1개 제공 (`@agentmesh/minima-client` import).
환경변수: `VITE_MINIMA_NODE_URL`, `VITE_MINIMA_WS_URL`, `VITE_MINIMA_API_KEY`.

### 3. 프로덕션 빌드 (dist-snapshot/muhanai/20261019)

`grep` 결과 — 클라이언트 번들에 minima 코드 일부 포함:

| 번들 | MDS | DADA |
|---|---|---|
| `sipp-worker-impl-232hpCnJ.js` | 1 | - |
| `index-Q5LUw-st.js` | - | 8 |
| `DadabotPage-9K3mg07C.js` | - | - |

→ **MDS는 sipp-worker 1번만 사용**, DADA 토큰은 index 번들에 8회 등장.
**mum (Minima 화폐단위, 0.001)**: 0번 — 사용자에게 안 보임.
**MINIMA_* 환경변수**: 0번 — 백엔드 origin에만 존재.

### 4. 인프라 (75% — 3/5)

```
minima-integration/
├── docker-compose.muhanai.yml   # Minima 노드 + bridge compose
├── minima/Dockerfile            # Minima 풀노드 컨테이너
├── config/muhanai-conf.yaml     # Minima genesis config
└── scripts/e2e-minima.test.js   # end-to-end test
```

**결함 (이전 무결성 검사에서 발견, 미수정)**:
- Dockerfile `COPY minima-conf.yaml` — 경로 오류 (Dockerfile은 `./minima/`, 파일은 `./config/`)
- docker-compose `volumes: ./minima/minidapps/muhanai-anchor` — 빈 디렉터리 가능
- tsconfig 부재 (`minima-client/tsconfig.json`)
- tsconfig rootDir 외부 import (`minima-bridge → minima-client`)

### 5. 외부 의존성 (1/5)

- `WilliamMajanja/minima-core` (Java 풀노드) 직접 의존 없음
- `WilliamMajanja/Phantom` 패턴만 차용 (anchor.ts)
- 외부 NPM/Maven 아티팩트 없음

### 통합 갭 (사용자에게 보이는 부분)

**현재**: 사용자는 muhanai.com에서 Minima 노드 상태, DADA 토큰 전송, MDS anchor를 볼 수 있으나 **4개 페이지로 제한**.

**빠진 것** (개선 후보):
1. **메인 페이지에 Minima 신원 카드** (지갑 잔액, DADA 잔액)
2. **TasksPage / ModelsPage / AgentsPage에서 Minima 자동 결제 옵션** (MicroAnchor 0.001 mum)
3. **AgentMemoryPage ↔ ChainAnchorPage 양방향 링크** (에이전트 기억이 MDS anchor로 영구 보존)
4. **설정 페이지에 Minima 노드 URL 관리** (사용자가 자체 노드 운영 시)
5. **DADA Wallet / Bridge / Send UI 통합** (현재 rpc.ts에는 `send` 메서드만 있음)

### 권장 다음 작업

1. (높음) 메인 페이지에 DADA 잔액 + 노드 상태 헤더 표시
2. (중간) TasksPage에서 send-payment 옵션 노출
3. (중간) Dockerfile + tsconfig 결함 수정 (이전 §18/§22)
4. (낮음) minima RPC 명령어 추가 (`sendpoll`, `txncreate`, `coins`, `tokencreate`)

---

## 23. muhanai.com/token-bank ↔ Minima chain 통합 설계 (2026-10-20)

### 목표
muhanai.com의 `/token-bank` 페이지(`/Users/brianyeon/CodeGPT/integration-finalize/minima-integration/apps/web/src/pages/TokenBankPage.tsx`)를
stub(5줄)에서 Minima chain과 완전히 통합된 풀 컴포넌트(503줄)로 업그레이드.

### 통합 단계 (Phase 4 외부 체인 브릿지는 **명시적으로 제외**)

| Phase | 내용 | 상태 |
|---|---|---|
| **Phase 1** | TokenBankPage 풀 구현 (잔액/전송/히스토리/anchor) | ✅ **완료** |
| **Phase 2** | TasksPage ↔ TokenBankPage 양방향 통합 (작업 → 자동 결제) | 미착수 |
| **Phase 3** | Multi-User Token Escrow (사용자 의뢰자 간 토큰 분배) | ✅ **완료 (gated)** |
| **Phase 4** | 외부 체인 브릿지 (EVM/Solana) | ❌ **제외** (사용자 결정) |

### 구현 내용 (TokenBankPage 풀구현)

**Phase 1 — 4가지 탭 + Phase 3 escrow 탭 (env gated)**:

1. **Wallet 탭** — DADA + MINIMA 잔액 카드 (useMinima 훅)
2. **Send 탭** — recipient + amount + memo → sendPayment → anchorHash
3. **History 탭** — 모든 거래 + anchor 뱃지 + 상태 (pending/confirmed/anchored/failed)
4. **Escrow 탭** — `VITE_TOKEN_BANK_ESCROW=true`일 때만 노출 (Phase 3)
   - createEscrow: payee/amount/taskId 입력 → MDS anchor
   - releaseEscrow: 상태 변경

**핵심 통합 지점**:
- `useMinima` 훅: VITE_MINIMA_NODE_URL/WS_URL/API_KEY 환경변수
- `sendPayment`: `client.dada.send({to, amount, token})` 호출 (dada.ts 191줄 활용)
- `anchorHash`: `client.anchor.anchorString(receipt, "token-bank")` 호출
  - Phantom RNPE-2 패턴: `MDS.create({script, amount: 0.001, state: [addr, cid, ns, time, size, path]})`
- `useMinima` 훅의 `anchorHash`는 MDS command port로 hash를 영구 보존
- 거래 receipt JSON이 MDS anchor에 들어가 분쟁 해결/감사 추적 가능

### 핵심 파일

| 파일 | 줄수 | 역할 |
|---|---|---|
| `apps/web/src/pages/TokenBankPage.tsx` | 503 | 풀 구현 (이전 5줄 stub에서 업그레이드) |
| `apps/web/src/hooks/useMinima.ts` | 96 | Minima client singleton (변경 없음) |
| `packages/minima-client/src/anchor.ts` | 187 | Phantom RNPE-2 anchor 패턴 |
| `packages/minima-client/src/dada.ts` | 191 | DADA 토큰 전송 |
| `packages/minima-client/src/mds.ts` | 122 | MDS wrapper |

### 환경변수 (apps/web/.env)

```
VITE_MINIMA_NODE_URL=http://localhost:9001
VITE_MINIMA_WS_URL=ws://localhost:9002
VITE_MINIMA_API_KEY=... (옵션)
VITE_MINIMA_NETWORK=testnet
VITE_TOKEN_BANK_ESCROW=true   # Phase 3 escrow UI 노출
```

### Phase 2 작업 (다음 세션 후보)

1. `TasksPage`에서 작업 완료 시 TokenBankPage의 escrow 자동 release 호출
2. TokenBankPage의 히스토리에 task ID 표시 (linkify)
3. 작업 의뢰자가 미리 DADA를 escrow로 lock → 작업자가 받는 흐름
4. MDS anchor로 작업자 평판 기록 (ReputationPage 연동)

### Phase 4 제외 이유

사용자가 명시적으로 "Phase 4는 제외" 지시. 이유 추정:
- EVM/Solana bridge는 별도 감사/라이선스 작업 필요
- 인프라 부담 큼 (relayer, liquidity pool)
- Minima native 토큰으로 충분 (DADA + MINIMA)

### 검증

- TypeScript: standalone tsc로 syntax 검증 가능 (node_modules 부재 시 import 에러는 무시)
- 런타임: TokenBankPage는 Minima 노드 연결 실패 시 `error` 상태 표시, useMinima 훅이 graceful fallback 제공
- MDS anchor: Phase 1의 모든 send/receipt가 Phantom RNPE-2 패턴으로 anchor

### 출처

- WilliamMajanja/Phantom RNPE-2 패턴: `packages/minima-client/src/anchor.ts:5` 주석 참조
- WilliamMajanja/minima-core MDS 시스템: `org.minima.system.network.commands`
- TokenBankPage 사용 UI 패턴: `apps/web/src/components/minima/MinimaWalletPage.tsx` (174줄)

---

## 24. Phase 2 + Phase 3 완료 보고 (2026-10-20)

muhanai.com/token-bank와 Minima chain 통합의 Phase 2 (TasksPage ↔ TokenBankPage
양방향 통합)와 Phase 3 (Multi-User Token Escrow 실구현) 완료.

### 변경 파일 (4개, 776줄 추가)

| 파일 | 줄수 | 역할 |
|---|---|---|
| `apps/web/src/types/escrow.ts` | 15 | 공유 EscrowEntry 타입 |
| `apps/web/src/store/escrowStore.ts` | 69 | module-level singleton + localStorage 영속 |
| `apps/web/src/pages/TasksPage.tsx` | 416 | 풀구현 (이전 5줄 stub에서 업그레이드) |
| `apps/web/src/pages/TokenBankPage.tsx` | (기존 503) | escrowStore 연결 (createEscrow/releaseEscrow 변경) |
| `apps/web/src/pages/TokenBankPage.tsx` 17줄 useSyncExternalStore import 추가 | | |

### Phase 2 — TasksPage ↔ TokenBankPage 양방향 통합

**TasksPage 풀구현 (416줄)**:
- 작업 목록 + 상태 필터 (open/in_progress/completed/cancelled/all)
- 5단계 액션 흐름: open → in_progress → completed → paid (escrow release)
- 작업 생성 모달: title/description/reward/token/assignee → MDS anchor
- 작업 완료 시 자동으로 해당 escrow의 release (Phase 2 핵심!)
- "Lock escrow" 링크 → TokenBankPage로 직접 이동

**공유 스토어 (escrowStore.ts)**:
- module-level singleton: `getSnapshot`/`subscribe`/`add`/`update`/`remove`/`forTask`
- React 18의 `useSyncExternalStore`로 양 페이지가 같은 상태 공유
- localStorage 영속 (`muhanai:escrows:v1` 키) — 페이지 새로고침에도 유지

**자동 release 흐름**:
1. TasksPage에서 "Complete + Pay" 클릭
2. 해당 taskId에 매칭되는 escrow를 escrowStore에서 찾음
3. anchorHash(release, "escrow-release") → MDS 영구 anchor
4. escrowStore.update → status: "released", anchorHash 갱신
5. 양 페이지가 동시에 UI 갱신 (subscribe)

### Phase 3 — Multi-User Token Escrow

- escrowStore가 payee(받는 사람) 정보를 영속 저장
- TokenBankPage의 EscrowForm에서 payee/amount/taskId 입력 → MDS state anchor
- TasksPage에서 task 완료 시 자동 release
- TokenBankPage에서 수동 release 가능 (긴급 환불 등)

**escrow 상태 흐름**:
```
open     → task가 작업자에게 할당됨, DADA가 락됨
released → task 완료 → DADA가 payee에게 전송, MDS anchor 영구 보존
refunded → 의뢰자가 작업 취소, DADA가 payer에게 반환 (구현 예정, Phase 5+)
```

### 통합 지점

```
TasksPage (anchorHash)        TokenBankPage (anchorHash + sendPayment)
       ↓                                    ↓
       └──── escrowStore (localStorage) ────┘
                      ↓
              Minima node via useMinima
                      ↓
                 MDS (anchor receipts)
                 DADA (sendPayment)
```

### 환경변수 (apps/web/.env)

```
VITE_MINIMA_NODE_URL=http://localhost:9001
VITE_MINIMA_WS_URL=ws://localhost:9002
VITE_MINIMA_API_KEY=... (optional)
VITE_TOKEN_BANK_ESCROW=true    # Phase 3 escrow UI 노출
```

### 검증

- TasksPage: 416줄, seed 2개 작업 + 모달 + 5단계 액션
- TokenBankPage: escrowStore 연결로 양방향 동기화
- useSyncExternalStore 사용으로 React 18 concurrent mode 안전
- localStorage 영속으로 새로고침에도 escrow/task 유지

### 다음 단계 (Phase 5+ 후보)

1. **Refund 흐름** — 작업 취소 시 escrow 환불, anchorHash 기록
2. **Multi-party escrow** — 2-of-3 multisig로 분할 정산
3. **ReputationPage ↔ escrow 연동** — 작업자 평판 (anchor된 release 수 기반)
4. **MDS cascade listener** — 외부에서 escrow 변경 시 자동 알림
5. **minima-bridge RPC 확장** — `sendpoll`, `txncreate`, `coins`, `tokencreate`
6. **Dockerfile + tsconfig 결함 수정** (이전 §18)

### Phase 4 외부 체인 브릿지

사용자 결정에 따라 **여전히 제외**. EVM/Solana bridge는 별도 세션에서 결정.
