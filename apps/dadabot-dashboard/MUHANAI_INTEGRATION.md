# Muhanai.com — Dadabot 진입점 통합 가이드

## 📍 진입 위치

**muhanai.com 메인 dashboard** (`/Users/brianyeon/muhanai-folder/muhanai/muhanai/web-app/public/dashboard-v2.html`) 의 사이드바 8번째 항목으로 추가:

```
기존 7개 Spaces:
  코스믹 메시 (mesh)
  컴퓨트 메시 (compute)
  지식 시장 (knowledge)
  연방 (fed)
  MCP 마켓 (mcp)
  LLM 허브 (llm)
  1-Click 팩토리 (factory)

추가 1개 Space (8번째):
  🪆 다다봇 (dadabot)  ← NEW
```

## 1️⃣ Sidebar 버튼 추가 (HTML 라인 781 직전)

**파일**: `dashboard-v2.html` 라인 787 다음에 삽입:

```html
<button class="nav-item" data-space="dadabot"><span class="dot" aria-hidden="true"></span>다다봇<span class="count">44</span></button>
```

## 2️⃣ SPACE_META 등록 (라인 1230)

**파일**: `dashboard-v2.html` 라인 1238 다음에 추가:

```javascript
dadabot:   ["다다봇",      "agentmesh://local · 6 free providers · 0 api keys needed"],
```

## 3️⃣ renderModule 분기 추가 (라인 1330 부근)

**파일**: `dashboard-v2.html` `renderModule()` 함수 내 else if 체인에 추가:

```javascript
} else if (space === "dadabot") {
  html =
    '<div class="mod-grid">' +
    '<div class="gpu-card">' +
      '<div class="gpu-head"><span class="gpu-name">🪆 다다봇</span><span class="state-pill ok">Beta</span></div>' +
      '<p class="gpu-desc">로컬-퍼스트 AI 에이전트 OS — 44개 무료 모델 + 인간 승인 워크플로우</p>' +
      '<pre class="ddb-cmd">curl -fsSL https://dadabot.dev/install.sh | sh</pre>' +
      '<button class="ddb-cta" onclick="window.open(\'/dadabot\', \'_blank\')">대시보드 열기</button>' +
    '</div>' +
    '<div class="gpu-card">' +
      '<div class="gpu-head"><span class="gpu-name">🛡️ 안전</span><span class="state-pill ok">5단계</span></div>' +
      '<p class="gpu-desc">3-tier 권한 · ChangeRequest · Inbox</p>' +
    '</div>' +
    '<div class="gpu-card">' +
      '<div class="gpu-head"><span class="gpu-name">🎨 캔버스</span><span class="state-pill ok">CRDT</span></div>' +
      '<p class="gpu-desc">BlockSuite 호환 · Y.js 동기화</p>' +
    '</div>' +
    '<div class="gpu-card">' +
      '<div class="gpu-head"><span class="gpu-name">🤖 6개 무료 모델</span><span class="state-pill ok">keyless</span></div>' +
      '<p class="gpu-desc">Groq · Cerebras · NVIDIA · Gemini · Mistral · GitHub Models</p>' +
    '</div>' +
    '</div>';
}
```

## 4️⃣ CSS 추가 (스타일 정의 끝에)

**파일**: `dashboard-v2.html` `<style>` 블록 끝에:

```css
.ddb-cmd {
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px 14px;
  border-radius: 8px;
  font-family: "SF Mono", monospace;
  font-size: 12px;
  overflow-x: auto;
  margin: 12px 0;
}
.ddb-cta {
  background: #f59e0b;
  color: #0f172a;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  width: 100%;
}
.ddb-cta:hover { background: #fbbf24; }
```

## 5️⃣ 라우트 추가 (React Router 또는 page redirect)

다다봇 라우트가 `/dadabot`에 마운트되어야 합니다. muhanai.com 라우터 구조에 따라:

```javascript
// router.tsx (muhanai.com 측)
{
  path: "/dadabot",
  element: <DadabotLandingPage />  // apps/dadabot-dashboard에서 export
}
```

또는 iframe 임베드:

```html
<iframe src="/dadabot/" style="width:100%; height:100vh; border:none;" />
```

## 📦 적용 후 사용자 경험

1. **muhanai.com 메인 진입** → 사이드바에 🪆 다다봇 (count: 44)
2. **클릭** → 4-카드 그리드: 설치 명령어, 안전, 캔버스, 모델
3. **"대시보드 열기"** → `/dadabot` 풀-페이지 진입점 (LandingPage 컴포넌트)
4. **Hero에서 install 명령 복사** → `curl -fsSL https://dadabot.dev/install.sh | sh`
5. **설치 후** `/inbox`, `/canvas`, `/safety` 진입

## ✅ 빌드 검증

```bash
cd /Users/brianyeon/CodeGPT/integration-finalize/apps/dadabot-dashboard
./node_modules/.bin/tsx --test test/dashboard.test.ts   # 14/14 ✔
./node_modules/.bin/tsc --noEmit                        # 0 errors
```

## 🔗 핵심 파일

| 파일 | 역할 |
|------|------|
| `apps/dadabot-dashboard/src/pages/LandingPage.tsx` | muhanai.com 진입점 (NEW) |
| `apps/dadabot-dashboard/src/App.tsx` | `/dadabot` 라우트 등록 |
| `apps/dadabot-dashboard/src/lib/sidebar.tsx` | 사이드바에 Home 항목 추가 |
| `apps/dadabot-dashboard/src/lib/dashboard.css` | 랜딩 스타일 |
