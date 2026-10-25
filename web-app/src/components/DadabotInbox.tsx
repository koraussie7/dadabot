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

/** DadabotInbox - displays pending change requests with approval actions */
export function DadabotInbox() {
  const [requests, setRequests] = useState<DadbabotChangeRequest[]>([]);
  const [filters, setFilters] = useState<{
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
    if (data) setRequests(JSON.parse(data));
    else {
      // Sample proposals demonstrating autoMerge vs changeRequest
      setRequests([
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
          title: "설정 파일 수정",
          rationale: "환경 변수 경로 수정",
          category: "file_edit",
          confidence: 0.75,
          autonomyLevel: 1,
          reversible: true,
          touchesProtected: true,
          permission: "changeRequest",
          createdAt: new Date(Date.now() - 7200000).toISOString(),
          proposedBy: "dadabot-agent",
        },
      ]);
      localStorage.setItem("dadabot_inbox", JSON.stringify(requests));
    }
  }, []);

  const filtered = requests.filter(
    (r) =>
      filters.status === "all"
        ? true
        : r.permission === filters.status ||
          (r.permission === "autoMerge" && filters.status === "pending") ||
          (r.permission === "changeRequest" && filters.status === "pending") ||
          (r.permission === "read" && filters.status === "approved") ||
          (r.permission === "read" && filters.status === "rejected")
      : true,
    (r) =>
      filters.permission === "all"
        ? true
        : filters.permission === r.permission,
    (r) =>
      filters.category === "all" || filters.category === r.category
  );

  return (
    <div className="space-y-3">
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Sparkles className="inline mr-1" /> <span>대기 중인 제안 없음</span>
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
                  <h4 className="font-medium text-line line-clamp line-clamp={2}">
                    {r.title}
                  </h4>
                  <p className="text-xs text-muted-foreground line-clamp line-clamp={2}">
                    {r.rationale}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {r.permission === "autoMerge" && (
                    <span className="bg-green-100 text-green-800 text-xs font-medium rounded px-2 py-1">
                      auto-merged (감사 로그)
                    </span>
                  )}
                  {r.permission === "changeRequest" && (
                    <span className="bg-yellow-100 text-orange-800 text-xs font-medium rounded px-2 py-1">
                      human approval 필요
                    </span>
                  )}
                  {r.permission === "read" && (
                    <span className="bg-gray-100 text-gray-800 text-xs font-medium rounded px-2 py-1">
                      읽기 전용
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span>{r.category}</span>
                <span>autonomy {r.autonomyLevel}</span>
                {r.touchesProtected && (
                  <span className="bg-red-100 text-red-800 text-xs rounded px-1">
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