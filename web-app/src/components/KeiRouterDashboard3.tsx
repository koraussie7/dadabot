import React, { useEffect, useState } from "react";
import {
  Sparkles,
  Zap,
  ShieldCheck,
  TrendingDown,
  Coins,
  History,
  Send,
  Server,
  CheckCircle2,
  Clock,
  ArrowRight,
} from "lucide-react";
import CreditChargeModal from "./CreditChargeModal";
import CreditInsufficientModal from "./CreditInsufficientModal";
import { routeKeiPrompt, type KeiRoutingMode } from "../lib/kei-router-client.js";

export type RoutingMode = KeiRoutingMode;

interface RoutingHistoryItem {
  id: string;
  timestamp: string;
  prompt: string;
  selectedModel: string;
  cost: number;
  savedUsd: number;
  latencyMs: number;
  mode: RoutingMode;
  status: "success" | "mock" | "fallback";
}

interface ModelTier {
  id: string;
  name: string;
  provider: string;
  contextWindow: string;
  costPer1k: string;
  status: "online" | "congested" | "offline";
  isFree: boolean;
  recommendedFor: string;
}

const AVAILABLE_MODELS: ModelTier[] = [
  {
    id: "local/qwen2.5-coder",
    name: "Qwen 2.5 Coder 7B",
    provider: "On-Device / Local Ollama",
    contextWindow: "32K",
    costPer1k: "$0.00 (무료)",
    status: "online",
    isFree: true,
    recommendedFor: "간단한 함수 작성, 문법 검사, 일상 질의",
  },
  {
    id: "openrouter/free",
    name: "OpenRouter Free Pool",
    provider: "OpenRouter Community",
    contextWindow: "8K - 16K",
    costPer1k: "$0.00 (무료)",
    status: "online",
    isFree: true,
    recommendedFor: "문서 요약, 초안 작성, 일반 코딩",
  },
  {
    id: "kilo/claude-sonnet",
    name: "Claude Sonnet",
    provider: "Kilo Gateway (Pooled)",
    contextWindow: "200K",
    costPer1k: "Usage-based",
    status: "online",
    isFree: false,
    recommendedFor: "복합 리팩토링, 아키텍처 설계, 보안 감사",
  },
  {
    id: "kilo/claude-opus",
    name: "Claude Opus",
    provider: "Kilo Gateway (Tier-1)",
    contextWindow: "200K",
    costPer1k: "Usage-based",
    status: "online",
    isFree: false,
    recommendedFor: "수학적 추론, 심층 최적화, 전략적 분석",
  },
];

const HISTORY_KEY = "muhanai.kei-router.history.v1";
const readHistory = (): RoutingHistoryItem[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const data: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(data) ? (data as RoutingHistoryItem[]).slice(0, 30) : [];
  } catch {
    return [];
  }
};

export function KeiRouterDashboard3() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<RoutingMode>("auto");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"gateway" | "history" | "tiers">("gateway");
  const [mhtBalance, setMhtBalance] = useState<number | null>(null);
  const [kiloCreditBalance, setKiloCreditBalance] = useState<number | null>(null);
  const [totalSavedUsd, setTotalSavedUsd] = useState(0);
  const [showChargeModal, setShowChargeModal] = useState(false);
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<{
    content: string;
    path: string;
    cost: number;
    savedUsd: number;
    latencyMs: number;
  } | null>(null);
  const [history, setHistory] = useState<RoutingHistoryItem[]>(readHistory);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/credits/charge", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Credits API returned HTTP ${response.status}`);
        const data: unknown = await response.json();
        if (!data || typeof data !== "object") throw new Error("Invalid credits response");
        const credits = data as { mht?: unknown; kiloCredit?: unknown; remainingMht?: unknown; remainingCredit?: unknown };
        const mht = typeof credits.mht === "number" ? credits.mht : credits.remainingMht;
        const kiloCredit = typeof credits.kiloCredit === "number" ? credits.kiloCredit : credits.remainingCredit;
        if (typeof mht !== "number" || typeof kiloCredit !== "number") {
          throw new Error("Credits API response is missing numeric balances");
        }
        if (!cancelled) {
          setMhtBalance(mht);
          setKiloCreditBalance(kiloCredit);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "크레딧 잔액을 불러오지 못했습니다.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRunRouting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);

    try {
      const result = await routeKeiPrompt(prompt.trim(), mode);
      const savedUsd = result.savedUsd ?? 0;
      const outputContent = result.content?.trim() || "응답 내용이 비어 있습니다.";
      const next = {
        content: outputContent,
        path: result.path,
        cost: result.cost,
        savedUsd,
        latencyMs: result.latencyMs,
      };
      setLatestResult(next);
      setTotalSavedUsd((previous) => previous + savedUsd);
      setPrompt("");

      const item: RoutingHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toLocaleTimeString(),
        prompt: prompt.trim().slice(0, 160),
        selectedModel: result.path,
        cost: result.cost,
        savedUsd,
        latencyMs: result.latencyMs,
        mode,
        status: result.path.toLowerCase().includes("mock") ? "mock" : "success",
      };
      setHistory((previous) => {
        const updated = [item, ...previous].slice(0, 30);
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
        } catch {
          // History is best-effort; never block a successful routing result.
        }
        return updated;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "라우팅 요청 처리 중 오류가 발생했습니다.");
      setLatestResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 font-sans pb-16">
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#0d131f]/90 backdrop-blur-md px-4 sm:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-violet-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Zap className="size-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white text-base">MuhanAI</span>
                <span className="rounded-full bg-cyan-500/10 border-cyan-400/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">Dashboard 3.0 · KeiRouter</span>
              </div>
              <p className="text-[11px] text-slate-400">Zero-Token Coding &amp; Inference Gateway</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1 text-xs font-medium">
            {([
              ["gateway", "스마트 게이트웨이"],
              ["tiers", "모델 계층 (Tiers)"],
              ["history", `라우팅 로그 (${history.length})`],
            ] as const).map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id)} className={`px-3 py-1.5 rounded-lg transition-all ${activeTab === id ? "bg-slate-800 text-white font-semibold" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"}`}>
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border-slate-700/60 bg-slate-900/60 text-xs">
            <div className="flex items-center gap-1.5 text-amber-300"><Coins className="size-3.5" /><span className="font-semibold">{mhtBalance === null ? "—" : mhtBalance}</span><span className="text-[10px] text-slate-400">MHT</span></div>
            <div className="h-3 w-px bg-slate-700" />
            <div className="flex items-center gap-1.5 text-cyan-300"><Sparkles className="size-3.5" /><span className="font-semibold">{kiloCreditBalance === null ? "—" : kiloCreditBalance.toFixed(2)}</span><span className="text-[10px] text-slate-400">Credit</span></div>
          </div>
          <button onClick={() => setShowChargeModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white shadow-md shadow-cyan-600/20 transition-all">MHT 충전</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 mt-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <MetricCard label="누적 절약액" value={`$${totalSavedUsd.toFixed(3)}`} icon={<TrendingDown className="size-4" />} accent="cyan" detail="이번 세션에서 확인된 라우팅 응답 기준" />
          <MetricCard label="라우팅 요청 수" value={history.length} icon={<ShieldCheck className="size-4" />} accent="violet" detail="저장된 최근 30건" />
          <MetricCard label="마지막 지연시간" value={latestResult ? `${latestResult.latencyMs} ms` : "—"} icon={<Clock className="size-4" />} accent="amber" detail="실제 API 응답에서 측정" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-8 space-y-6">
            {activeTab !== "tiers" && <div className="rounded-2xl border-slate-800 bg-[#0f1624] p-6 shadow-xl relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
                <div><h2 className="text-lg font-bold text-white flex items-center gap-2">KeiRouter AI Console <span className="rounded bg-cyan-500/10 text-cyan-300 text-[10px] font-semibold px-2 py-0.5 border-cyan-500/20">API connected</span></h2><p className="text-xs text-slate-400 mt-1">요청을 서버 API로 전달하며 provider credentials는 브라우저에 노출되지 않습니다.</p></div>
                <div className="flex items-center p-1 rounded-xl bg-slate-900/80 border-slate-800 text-xs">
                  {([ ["auto", "Auto"], ["free", "Free"], ["quality", "Quality"] ] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setMode(value)} className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${mode === value ? "bg-gradient-to-r from-cyan-600 to-violet-600 text-white shadow-sm" : "text-slate-400 hover:text-white"}`}>{label}</button>)}
                </div>
              </div>
              <form onSubmit={handleRunRouting} className="mt-5 space-y-4">
                <div className="relative">
                  <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="코딩 요청, 리팩토링, 아키텍처 설계 또는 일반 질문을 입력하세요..." rows={5} className="w-full rounded-xl bg-slate-900/80 border-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-slate-100 placeholder-slate-500 p-4 text-sm resize-none transition-all outline-none" />
                  <div className="absolute right-3 bottom-3 flex items-center gap-2"><span className="text-[11px] text-slate-500">{prompt.length}자 · {mode.toUpperCase()}</span><button type="submit" disabled={loading || !prompt.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-md transition-all">{loading ? <><span className="size-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />요청 중...</> : <><Send className="size-3.5" />라우팅 실행</>}</button></div>
                </div>
              </form>
              {error && <div role="alert" className="mt-4 rounded-xl border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{error}</div>}
              {latestResult && <div className="mt-5 p-4 rounded-xl border-slate-700/80 bg-slate-900/90 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-slate-800 pb-2"><div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-400" /><span className="font-semibold text-white">처리 완료</span><span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 font-mono text-[10px]">{latestResult.path}</span></div><div className="flex items-center gap-3 text-slate-400"><span>비용: <strong className="text-white">{latestResult.cost === 0 ? "0 (무료)" : `${latestResult.cost} Credit`}</strong></span><span>절약: <strong className="text-emerald-300">${latestResult.savedUsd.toFixed(3)}</strong></span><span>지연: <strong className="text-slate-300">{latestResult.latencyMs}ms</strong></span></div></div><pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">{latestResult.content}</pre></div>}
            </div>}

            {activeTab !== "tiers" && <div className="rounded-2xl border-slate-800 bg-[#0f1624] p-6 shadow-xl"><div className="flex items-center justify-between mb-4"><h3 className="font-bold text-white text-sm flex items-center gap-2"><History className="size-4 text-slate-400" /><span>최근 라우팅 히스토리</span></h3><span className="text-xs text-slate-400">로컬 저장</span></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-slate-800 text-slate-400"><tr><th className="pb-2">시간</th><th className="pb-2">프롬프트</th><th className="pb-2">모델</th><th className="pb-2">비용</th><th className="pb-2">절약</th><th className="pb-2">지연</th></tr></thead><tbody className="divide-y divide-slate-800/60">{history.map((item) => <tr key={item.id} className="hover:bg-slate-800/30"><td className="py-2.5 text-slate-400 whitespace-nowrap">{item.timestamp}</td><td className="py-2.5 text-slate-200 max-w-xs truncate">{item.prompt}</td><td className="py-2.5 font-mono text-cyan-200">{item.selectedModel}</td><td className="py-2.5 text-slate-300">{item.cost.toFixed(3)}</td><td className="py-2.5 text-emerald-400">${item.savedUsd.toFixed(3)}</td><td className="py-2.5 text-slate-400">{item.latencyMs}ms</td></tr>)}</tbody></table>{history.length === 0 && <p className="py-6 text-center text-slate-500">아직 라우팅 기록이 없습니다.</p>}</div></div>}
          </section>

          <aside className="lg:col-span-4 space-y-6">
            {activeTab !== "history" && <div className="rounded-2xl border-slate-800 bg-[#0f1624] p-5 shadow-xl"><h3 className="font-bold text-white text-sm mb-3 flex items-center gap-2"><Server className="size-4 text-cyan-400" /><span>모델 계층 (라우팅 후보)</span></h3><div className="space-y-3">{AVAILABLE_MODELS.map((model) => <div key={model.id} className="p-3.5 rounded-xl border-slate-800/80 bg-slate-900/60 text-xs"><div className="flex items-center justify-between mb-1"><span className="font-bold text-white">{model.name}</span><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${model.isFree ? "bg-emerald-500/10 text-emerald-400" : "bg-violet-500/10 text-violet-300"}`}>{model.costPer1k}</span></div><div className="text-[11px] text-slate-400 flex items-center justify-between mb-1.5"><span>{model.provider}</span><span>{model.contextWindow}</span></div><p className="text-[11px] text-slate-400 bg-slate-950/60 p-2 rounded-lg">🎯 {model.recommendedFor}</p></div>)}</div></div>}
            <div className="rounded-2xl border-slate-800 bg-gradient-to-br from-slate-900 via-[#0e1626] to-slate-950 p-5 shadow-xl"><div className="flex items-center justify-between mb-3"><h3 className="font-bold text-white text-sm flex items-center gap-2"><Coins className="size-4 text-amber-400" /><span>MHT 토큰</span></h3><span className="text-[10px] text-amber-300/80 bg-amber-500/10 px-2 py-0.5 rounded border-amber-500/20">100 MHT = 1 Credit</span></div><p className="text-xs text-slate-400 leading-relaxed mb-4">MHT와 Credit 잔액은 계정 API 연결 후 표시됩니다. 현재 라우팅 요청은 실제 서버 API를 호출합니다.</p><div className="p-3 rounded-xl bg-slate-950/80 border-slate-800/80 flex items-center justify-between text-xs mb-4"><div><div className="text-[11px] text-slate-500">MHT</div><div className="text-base font-bold text-amber-300 font-mono">{mhtBalance === null ? "—" : mhtBalance}</div></div><ArrowRight className="size-4 text-slate-600" /><div><div className="text-[11px] text-slate-500">Credit</div><div className="text-base font-bold text-cyan-300 font-mono">{kiloCreditBalance === null ? "—" : kiloCreditBalance.toFixed(2)}</div></div></div><div className="flex gap-2"><button type="button" onClick={() => setShowChargeModal(true)} className="flex-1 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs">MHT 충전</button><button type="button" onClick={() => setShowTopupModal(true)} className="px-3 py-2.5 rounded-xl border-slate-700 text-slate-300 hover:bg-slate-800 text-xs">잔액 부족</button></div></div>
          </aside>
        </div>
      </main>

      {mhtBalance !== null && kiloCreditBalance !== null && <CreditChargeModal open={showChargeModal} currentMht={mhtBalance} currentCredit={kiloCreditBalance} onClose={() => setShowChargeModal(false)} onSuccess={(remainingMht, remainingCredit) => { setMhtBalance(remainingMht); setKiloCreditBalance(remainingCredit); setShowChargeModal(false); }} />}
      <CreditInsufficientModal open={showTopupModal} required={1} current={kiloCreditBalance ?? 0} onClose={() => setShowTopupModal(false)} onUseFree={() => { setMode("free"); setShowTopupModal(false); }} onCharge={() => { setShowTopupModal(false); setShowChargeModal(true); }} />
    </div>
  );
}

function MetricCard({ label, value, icon, accent, detail }: { label: string; value: string | number; icon: React.ReactNode; accent: "cyan" | "violet" | "amber"; detail: string }) {
  const styles = {
    cyan: "border-cyan-500/20 bg-cyan-950/20 text-cyan-300",
    violet: "border-violet-500/20 bg-violet-950/20 text-violet-300",
    amber: "border-amber-500/20 bg-amber-950/20 text-amber-300",
  }[accent];
  return <div className={`p-5 rounded-2xl border ${styles} bg-gradient-to-br from-slate-900/80 to-slate-950/80 shadow-lg`}><div className="flex items-center justify-between text-xs mb-2"><span className="text-slate-400">{label}</span><span className="size-7 rounded-lg bg-white/5 flex items-center justify-center">{icon}</span></div><div className="text-2xl font-extrabold text-white tracking-tight">{value}</div><div className="mt-2 text-[11px] text-slate-400">{detail}</div></div>;
}
