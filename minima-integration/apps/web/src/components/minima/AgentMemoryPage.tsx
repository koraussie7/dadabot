/**
 * AgentMemoryPage.tsx — MDS Agent Memory UI
 * Store/retrieve/list content via MDS (Minima Data Service)
 */
import React, { useState } from "react";
import { useMinima } from "../../hooks/useMinima";
import { FileText, Save, Search, List, Trash2, Copy, Loader2 } from "lucide-react";

export function AgentMemoryPage() {
  const { client } = useMinima();
  const [namespace, setNamespace] = useState("agent-memory");
  const [storeTab, setStoreTab] = useState<"store" | "retrieve" | "list">("store");
  const [storeInput, setStoreInput] = useState("");
  const [storePath, setStorePath] = useState("");
  const [retrieveCid, setRetrieveCid] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);

  const handleStore = async (e: React.FormEvent) => {
    e.preventDefault();
    // In real: await client.mds.store({ cid, namespace, path, size, timestamp, address })
    alert("Store: " + storeInput.slice(0, 50) + "...");
  };

  const handleRetrieve = async () => {
    // In real: await client.mds.retrieve({ cid: retrieveCid, namespace })
  };

  const handleList = async () => {
    // In real: const items = await client.mds.list({ namespace, limit: 50 })
    setItems([
      { cid: "QmX...", path: "memory/1", size: 1024, timestamp: Date.now() },
      { cid: "QmY...", path: "memory/2", size: 2048, timestamp: Date.now() - 86400000 },
    ]);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[#14ebc0] to-[#06b6d4] bg-clip-text text-transparent">
          Agent Memory (MDS)
        </h1>
        <p className="text-[#71717a]">Minima Data Service — Store, retrieve, list content on-chain</p>

        {/* Namespace Selector */}
        <div className="bg-[#141418] p-4 rounded-xl border border-[#27272a] mb-6">
          <label className="block text-sm text-[#71717a] mb-2">Namespace</label>
          <input
            type="text"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white placeholder-[#71717a] focus:border-[#14ebc0] focus:outline:none"
          />
        </div>

        {/* Tabs */}
        <div className="bg-[#141418] rounded-xl border border-[#27272a] overflow-hidden">
          <div className="flex border-b border-[#27272a]">
            {["store", "retrieve", "list"].map((tab) => (
              <button
                key={tab}
                onClick={() => setStoreTab(tab as any)}
                className={`px-6 py-3 font-medium text-sm transition ${
                  storeTab === tab
                    ? "text-[#14ebc0] border-b-2 border-[#14ebc0]"
                    : "text-[#71717a] hover:text-white"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Store Tab */}
          {storeTab === "store" && (
            <form className="p-6 space-y-4" onSubmit={(e) => { e.preventDefault(); }}>
              <div>
                <label className="block text-sm text-[#71717a] mb-1">Path</label>
                <input
                  type="text"
                  value={storePath}
                  onChange={(e) => setStorePath(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white placeholder-[#71717a] focus:border-[#14ebc0] focus:outline:none"
                  placeholder="memory/note-1"
                />
              </div>
              <div>
                <label className="block text-sm text-[#71717a] mb-1">Content</label>
                <textarea
                  value={storeInput}
                  onChange={(e) => setStoreInput(e.target.value)}
                  rows={6}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white placeholder-[#71717a] focus:border-[#14ebc0] focus:outline-none resize-none"
                  placeholder="Content to store on-chain..."
                />
              </div>
              <button type="submit" className="w-full bg-[#14ebc0] text-[#09090b] font-semibold py-3 rounded-xl hover:opacity-90 transition flex items-center justify-center gap-2">
                <Save className="w-5 h-5" /> Store to MDS
              </button>
            </form>
          )}

          {/* Retrieve Tab */}
          {storeTab === "retrieve" && (
            <form className="p-6 space-y-4" onSubmit={(e) => { e.preventDefault(); }}>
              <div>
                <label className="block text-sm text-[#71717a] mb-1">CID</label>
                <input
                  type="text"
                  value={retrieveCid}
                  onChange={(e) => setRetrieveCid(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white placeholder-[#71717a] focus:border-[#14ebc0] focus:outline:none"
                  placeholder="QmX... or SHA-256 hash"
                />
              </div>
              <button type="submit" className="w-full bg-[#14ebc0] text-[#09090b] font-semibold py-3 rounded-xl hover:opacity-90 transition flex items-center justify-center gap-2">
                <Search className="w-5 h-5" /> Retrieve
              </button>
            </form>
          )}

          {/* List Tab */}
          {storeTab === "list" && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Stored Items</h3>
                <button onClick={handleList} disabled={loading} className="px-4 py-2 bg-[#14ebc0] text-[#09090b] font-semibold rounded-xl hover:opacity-90 transition flex items-center gap-2">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <List className="w-4 h-4" />}
                  Refresh
                </button>
              </div>
              {items.length === 0 ? (
                <div className="text-center py-12 text-[#71717a]">
                  <List className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No items in this namespace</p>
                </div>
              ) : (
                <div className="divide-y divide-[#27272a]">
                  {items.map((item: any, i: number) => (
                    <div key={i} className="p-4 flex items-center justify-between hover:bg-[#1f1f1f]">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-[#71717a]" />
                        <div>
                          <p className="font-mono text-sm">{item.path}</p>
                          <p className="text-xs text-[#71717a]">{item.cid.slice(0, 20)}... · {item.size} bytes</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="p-2 hover:bg-[#27272a] rounded-lg" onClick={() => navigator.clipboard.writeText(item.cid)}>
                          <Copy className="w-4 h-4 text-[#71717a]" />
                        </button>
                        <button className="p-2 hover:bg-[#27272a] rounded-lg text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentMemoryPage;