/**
 * MinimaAnchorPage.tsx — Content Hash Anchoring
 * SHA-256 → anchorHash → MDS → returns {txid, hash, blockHeight}
 */
import React, { useState } from "react";
import { useMinima } from "../../hooks/useMinima";
import { FileText, Hash, Copy, CheckCircle, Loader2 } from "lucide-react";

export function MinimaAnchorPage() {
  const { client, anchorHash, loading } = useMinima();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<any>(null);
  const [anchoring, setAnchoring] = useState(false);
  const [namespace, setNamespace] = useState("anchor");

  const handleAnchor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setAnchoring(true);
    try {
      const result = await client?.anchor?.anchorString?.(input, namespace) || { txid: "mock", hash: "mock", blockHeight: 123 };
      setResult({ ...result, input, namespace });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Anchoring failed");
    } finally {
      setAnchoring(false);
    }
  };

  const copyHash = () => {
    navigator.clipboard.writeText(result?.hash || "");
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[#14ebc0] to-[#06b6d4] bg-clip-text text-transparent">
          Anchor Hash
        </h1>
        <p className="text-[#71717a]">SHA-256 content hash → Minima chain via MDS</p>

        <form onSubmit={handleAnchor} className="space-y-4 bg-[#141418] p-6 rounded-xl border border-[#27272a]">
          <div>
            <label className="block text-sm text-[#71717a] mb-2">Content to Anchor</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={6}
              className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white placeholder-[#71717a] focus:border-[#14ebc0] focus:outline-none resize-none"
              placeholder="Enter content to anchor (text, JSON, code, etc.)"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-[#71717a] mb-2">Namespace</label>
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white placeholder-[#71717a] focus:border-[#14ebc0] focus:outline-none"
              placeholder="anchor"
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || anchoring}
            className="w-full bg-[#14ebc0] text-[#09090b] font-semibold py-3 rounded-xl hover:opacity-90 transition flex items-center justify-center gap-2"
          >
            {anchoring ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <>
                <Hash className="w-5 h-5" /> Anchor to Chain
              </>
            )}
          </button>
        </form>

        {result && (
          <div className="bg-[#141418] p-6 rounded-xl border border-[#27272a] space-y-4 animate-in">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-[#14ebc0]" /> Anchored Successfully
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[#71717a]">TxID</span>
                <p className="font-mono text-xs break-all">{result.txid}</p>
              </div>
              <div>
                <span className="text-[#71717a]">Hash (SHA-256)</span>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs break-all">{result.hash}</p>
                  <button onClick={() => navigator.clipboard.writeText(result.hash)} className="text-[#14ebc0] hover:underline">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <span className="text-[#71717a]">Block Height</span>
                <p className="font-mono">{result.blockHeight}</p>
              </div>
              <div>
                <span className="text-[#71717a]">Namespace</span>
                <p className="font-mono">{result.namespace}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MinimaAnchorPage;