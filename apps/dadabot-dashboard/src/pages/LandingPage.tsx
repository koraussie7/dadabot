/**
 * LandingPage.tsx — Dadabot entry point on muhanai.com.
 *
 * This is the FIRST thing a user sees when they click the "다다봇" sidebar
 * item on muhanai.com main dashboard. Designed to:
 *
 *   1. Show a hero with the install command (copy-paste ready)
 *   2. Surface 4 high-impact feature cards (one per category)
 *   3. Show a live "is dadabot running on this device?" status check
 *   4. Provide direct deep-links to /inbox, /canvas, /safety
 *
 * Drop-in mode: on muhanai.com, this page is mounted at /dadabot route
 * and inherits muhanai's DashboardLayout. The standalone dashboard at
 * apps/dadabot-dashboard wraps it in our own DashboardShell.
 */
import * as React from "react";
import { DashboardShell } from "../components/DashboardShell.tsx";
import "../lib/dashboard.css";

interface FeatureCard {
  emoji: string;
  title: string;
  body: string;
  href: string;
  highlight?: string;
}

const FEATURES: FeatureCard[] = [
  {
    emoji: "🤖",
    title: "44개의 무료 AI 모델",
    body: "Groq · Cerebras · NVIDIA · Gemini · Mistral · GitHub Models — API 키 1개만 있으면 6개 provider 자동 폴백.",
    href: "/canvas",
    highlight: "API 키 1개",
  },
  {
    emoji: "🛡️",
    title: "인간 승인 워크플로우",
    body: "3단계 권한 + ChangeRequest + Inbox. AI가 모든 위험 액션 전에 사람에게 확인을 요청합니다.",
    href: "/inbox",
    highlight: "human-in-the-loop",
  },
  {
    emoji: "🎨",
    title: "블록 캔버스",
    body: "AI 메시지 · 사람 메모 · 코드 스니펫을 블록 단위로 시각화. CRDT로 디바이스 간 자동 동기화.",
    href: "/canvas",
    highlight: "BlockSuite 호환",
  },
  {
    emoji: "⚡",
    title: "5단계 안전 파이프라인",
    body: "ingest → decide → submit → await → complete. 정책 + 감사 로그 + 실행 추적이 자동 기록됩니다.",
    href: "/safety",
    highlight: "5단계",
  },
];

interface StatusState {
  status: "checking" | "running" | "not-running";
  version?: string;
}

function useDadabotStatus(): StatusState {
  const [state, setState] = React.useState<StatusState>({ status: "checking" });
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/dadabot/ping", { credentials: "include" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          setState({ status: "running", version: j.version });
        } else {
          setState({ status: "not-running" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "not-running" });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function StatusBadge({ state }: { state: StatusState }): React.ReactElement {
  if (state.status === "checking") {
    return <span className="ddb-badge ddb-badge--muted">상태 확인 중…</span>;
  }
  if (state.status === "running") {
    return (
      <span className="ddb-badge ddb-badge--ok">
        ✓ 이 기기에 설치됨{state.version ? ` · v${state.version}` : ""}
      </span>
    );
  }
  return <span className="ddb-badge ddb-badge--warn">설치되지 않음</span>;
}

export interface LandingPageProps {
  /** When true, renders the muhanai-only banner; when false, fits dashboard */
  embedded?: boolean;
}

export function LandingPage({ embedded = true }: LandingPageProps): React.ReactElement {
  const status = useDadabotStatus();
  const installCmd = "curl -fsSL https://dadabot.dev/install.sh | sh";

  const content = (
    <div className="ddb-landing">
      {/* Hero */}
      <section className="ddb-hero">
        <h1 className="ddb-hero-title">
          <span className="ddb-hero-emoji">🪆</span> 다다봇
        </h1>
        <p className="ddb-hero-sub">
          로컬-퍼스트 AI 에이전트 OS. 무료 모델 44개 · 인간 승인 · 블록 캔버스.
        </p>

        <div className="ddb-install-row">
          <code className="ddb-install-cmd">{installCmd}</code>
          <button
            className="ddb-copy-btn"
            onClick={() => navigator.clipboard?.writeText(installCmd)}
            aria-label="설치 명령 복사"
          >
            복사
          </button>
        </div>

        <div className="ddb-status-row">
          <StatusBadge state={status} />
          {status.status === "not-running" && (
            <a className="ddb-link" href="/dadabot/setup">
              1분 셋업 가이드 →
            </a>
          )}
          {status.status === "running" && (
            <a className="ddb-link" href="/inbox">
              인박스 열기 →
            </a>
          )}
        </div>
      </section>

      {/* Feature grid */}
      <section className="ddb-features" aria-label="주요 기능">
        {FEATURES.map((f) => (
          <a key={f.title} className="ddb-card" href={f.href}>
            <div className="ddb-card-emoji" aria-hidden="true">
              {f.emoji}
            </div>
            <h3 className="ddb-card-title">{f.title}</h3>
            <p className="ddb-card-body">{f.body}</p>
            {f.highlight && (
              <span className="ddb-card-tag">{f.highlight}</span>
            )}
          </a>
        ))}
      </section>

      {/* Quick links */}
      <section className="ddb-quick">
        <a className="ddb-quick-link" href="/inbox">
          📥 인박스 <span className="ddb-quick-hint">승인 대기 변경 요청</span>
        </a>
        <a className="ddb-quick-link" href="/canvas">
          🎨 캔버스 <span className="ddb-quick-hint">블록 작업 공간</span>
        </a>
        <a className="ddb-quick-link" href="/safety">
          🛡️ 안전 파이프라인 <span className="ddb-quick-hint">정책 · 감사</span>
        </a>
      </section>

      {embedded && (
        <p className="ddb-foot">
          다다봇은 <a href="https://muhanai.com">muhanai.com</a>에 통합된 오픈소스 AI 에이전트 OS입니다.
        </p>
      )}
    </div>
  );

  return embedded ? (
    <DashboardShell activePath="/dadabot">{content}</DashboardShell>
  ) : (
    <div className="ddb-layout">
      <main className="ddb-main">{content}</main>
    </div>
  );
}

export default LandingPage;
