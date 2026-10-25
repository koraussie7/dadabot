import React, { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

/** Dadabot Change Request interface (from busabase-adapter policy.ts) */
export interface DadabotChangeRequest {
  id: string;
  title: string;
  rationale: string;
  category: string;
  confidence: number;
  autonomyLevel: number;
  reversible: boolean;
  touchesProtected: boolean;
  permission: "read" | "changeRequest" | "autoMerge";
  createdAt: string;
  proposedBy: string;
}

export interface DadabotInboxProps {
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  className?: string;
}

/** DadabotInbox - displays pending change requests with approval actions */
export function DadabotInbox(_props: DadabotInboxProps = {}) {
  const [requests, setRequests] = useState<DadabotChangeRequest[]>([]);
  const [filters] = useState<{
    status: "pending" | "approved" | "rejected" | "all";
    permission: "all" | "autoMerge" | "changeRequest" | "read";
    category: string;
  }>({
    status: "pending",
    permission: "all",
    category: "all",
  });

  useEffect(() => {
    const data = localStorage.getItem("dadabot_inbox");
    if (data) {
      try {
        setRequests(JSON.parse(data));
      } catch {
        // fallback
      }
    } else {
      // Sample proposals demonstrating autoMerge vs changeRequest
      const samples: DadabotChangeRequest[] = [
        {
          id: "cr-001",
          title: "로그 파일 정리",
          rationale: "디스크 공간 확보 및 데이터 보호",
          category: "file_edit",
          confidence: 0.96,
          autonomyLevel: 3,
          reversible: true,
          touchesProtected: false,
          permission: "autoMerge",
          createdAt: new Date().toISOString(),
          proposedBy: "dadabot-agent",
        },
        {
          id: "cr-002",
          title: "의존성 업데이트",
          rationale: "최신 보안 패치 적용",
          category: "package_install",
          confidence: 0.88,
          autonomyLevel: 2,
          reversible: false,
          touchesProtected: false,
          permission: "changeRequest",
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          proposedBy: "dadabot-agent",
        },
        {
          id: "cr-003",
          title: "설정 파일 변경 (/etc/hosts)",
          rationale: "호스트 라우팅 수정",
          category: "shell_command",
          confidence: 0.98,
          autonomyLevel: 3,
          reversible: true,
          touchesProtected: true,
          permission: "changeRequest",
          createdAt: new Date(Date.now() - 7200000).toISOString(),
          proposedBy: "dadabot-agent",
        },
      ];
      setRequests(samples);
      localStorage.setItem("dadabot_inbox", JSON.stringify(samples));
    }
  }, []);

  const filtered = requests.filter((r) => {
    if (filters.permission !== "all" && r.permission !== filters.permission) {
      return false;
    }
    if (filters.category !== "all" && r.category !== filters.category) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-3">
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground flex items-center gap-1">
          <Sparkles className="w-4 h-4" /> <span>대기 중인 제안 없음</span>
        </p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="bg-background rounded border border-border p-3 transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm line-clamp-2">
                    {r.title}
                  </h4>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {r.rationale}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 ml-2 shrink-0">
                  {r.permission === "autoMerge" && (
                    <span className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 text-xs font-medium rounded px-2 py-0.5">
                      auto-merged (감사 로그)
                    </span>
                  )}
                  {r.permission === "changeRequest" && (
                    <span className="bg-yellow-100 text-orange-800 dark:bg-yellow-950 dark:text-orange-300 text-xs font-medium rounded px-2 py-0.5">
                      human approval 필요
                    </span>
                  )}
                  {r.permission === "read" && (
                    <span className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 text-xs font-medium rounded px-2 py-0.5">
                      읽기 전용
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <span className="bg-muted px-1.5 py-0.5 rounded">{r.category}</span>
                <span>신뢰도 {(r.confidence * 100).toFixed(0)}%</span>
                <span>자율도 Lv.{r.autonomyLevel}</span>
                {r.touchesProtected && (
                  <span className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 text-xs font-semibold rounded px-1.5 py-0.5">
                    보호된 경로
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
