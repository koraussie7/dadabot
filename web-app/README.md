# @agentmesh/web — DadaBot Web Console

웹 기반 콘솔로 Dadabot의 BlockCanvas, Inbox, Console을 제공합니다.

## 구조

```
web-app/
├── src/
│   ├── main.tsx          # 진입점
│   ├── App.tsx           # 라우팅 + 페이지들
│   ├── index.css         # 전역 스타일 (Canvas 포함)
│   └── vite-env.d.ts     # Vite 타입 선언
├── packages/
│   ├── busabase-adapter/   # 인간 승인 워크플로우
│   ├── affine-adapter/     # BlockSuite 블록 캔버스
│   └── proposal-bridge/    # 5단계 안전 파이프라인
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── index.html
```

## 페이지

| 경로 | 설명 |
|------|------|
| `/console` | 자연어 명령 입력, 파이프라인 실행 |
| `/inbox` | Change Request 검토/승인/거절 |
| `/canvas` | BlockCanvas 시각적 에디터 |

## 실행

```bash
cd /Users/brianyeon/CodeGPT/integration-finalize/web-app
npm install
npm run dev
# → http://localhost:5173
```

## 테스트

```bash
# 전체 테스트 (67개)
cd /Users/brianyeon/CodeGPT/integration-finalize
./test-all.sh

# 또는 개별
cd packages/busabase-adapter && node --experimental-strip-types --no-warnings --test test/busabase.test.ts
cd packages/affine-adapter && node --experimental-strip-types --no-warnings --test test/affine.test.ts
cd packages/proposal-bridge && node --experimental-strip-types --no-warnings --test test/pipeline.test.ts
```

## 기술 스택

- **React 18** + **TypeScript** + **Vite 5**
- **React Router 6** (SPA 라우팅)
- **Zero 외부 의존성** (패키지들은 0-dependency)
- **Node 22+** `--experimental-strip-types`로 실행

## P3 완료 항목

- ✅ **P3-A**: BlockCanvas + Inbox + Console 페이지 구현
- 🔄 **P3-B**: dadabot CLI (`dadabot approve <crId>`) - 다음 단계
- 🔄 **P3-C**: Y.js 실제 통합 - 다음 단계
- 🔄 **P3-D**: Tauri v2 Mobile 빌드 - 다음 단계