export type KeiRoutingMode = "auto" | "free" | "quality" | "manual";

export interface KeiRouterResult {
  success: boolean;
  content?: string;
  path: string;
  cost: number;
  latencyMs: number;
  savedUsd?: number;
  error?: string;
}

/** Calls the MuhanAI web app's server proxy; provider credentials stay server-side. */
export async function routeKeiPrompt(
  prompt: string,
  mode: KeiRoutingMode,
  signal?: AbortSignal,
): Promise<KeiRouterResult> {
  const response = await fetch("/api/kei-router", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, mode }),
    signal: signal ?? AbortSignal.timeout(30_000),
  });

  let result: KeiRouterResult;
  try {
    result = (await response.json()) as KeiRouterResult;
  } catch {
    throw new Error(`KeiRouter returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok || !result.success) {
    throw new Error(result.error || `KeiRouter request failed (HTTP ${response.status}).`);
  }
  return result;
}
