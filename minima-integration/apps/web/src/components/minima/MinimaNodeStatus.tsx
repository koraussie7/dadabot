/**
 * MinimaNodeStatus.tsx — Node Status Monitor
 * Displays RPC block height, peer count, sync status
 */
import React, { useState, useEffect, useCallback } from "react";
import { useMinima } from "../../hooks/useMinima";
import { Wifi, WifiOff, Server, Activity, RefreshCw, ExternalLink } from "lucide-react";

export function MinimaNodeStatus() {
  const { client, refresh } = useMinima();
  const [status, setStatus] = useState<any>({
    height: 0,
    peers: 0,
    synced: false,
    version: "unknown",
    uptime: 0,
  });
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      // In real implementation: await client.rpc.getBlockHeight(), client.rpc.getPeers()
      // Mock data for now
      setStatus({
        height: 123456,
        peers: 8,
        synced: true,
        version: "0.1.0-beta.1",
        uptime: 86400,
      });
    } catch (err) {
      console.error("Failed to fetch node status:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[#14ebc0] to-[#06b6d4] bg-clip-text text-transparent">
            Node Status
          </h1>
          <button onClick={refresh} disabled={loading} className="p-2 hover:bg-[#141418] rounded-lg transition">
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Connection Status */}
        <div className="bg-[#141418] rounded-xl p-6 border border-[#27272a]">
          <div className="flex items-center gap-4 mb-6">
            <div className={`w-3 h-3 rounded-full ${status.synced ? "bg-[#14ebc0]" : "bg-red-500"}`} />
            <span className={`font-semibold ${status.synced ? "text-[#14ebc0]" : "text-red-500"}`}>
              {status.synced ? "Synced" : "Syncing"}
            </span>
            <span className="text-[#71717a] ml-auto">v{status.version}</span>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-[#09090b] p-4 rounded-xl border border-[#27272a]">
              <div className="flex items-center gap-2 text-[#71717a] mb-1">
                <Server className="w-4 h-4" />
                Block Height
              </div>
              <p className="text-2xl font-bold font-mono">{status.height.toLocaleString()}</p>
            </div>
            <div className="bg-[#09090b] p-4 rounded-xl border border-[#27272a]">
              <div className="flex items-center gap-2 text-[#71717a] mb-1">
                <Wifi className="w-4 h-4" />
                Connected Peers
              </div>
              <p className="text-2xl font-bold">{status.peers}</p>
            </div>
          </div>

          <div className="bg-[#09090b] p-4 rounded-xl border border-[#27272a]">
            <div className="flex items-center gap-2 text-[#71717a] mb-1">
              <Activity className="w-4 h-4" />
              Uptime
            </div>
            <p className="font-mono">{formatUptime(status.uptime)}</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button className="bg-[#14ebc0] text-[#09090b] font-semibold py-3 rounded-xl hover:opacity-90 transition flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5" /> Refresh
          </button>
          <a href="http://localhost:9001" target="_blank" rel="noopener noreferrer" className="bg-[#1f1f1f] text-white py-3 rounded-xl font-semibold hover:bg-[#27272a] transition flex items-center justify-center gap-2">
            <ExternalLink className="w-5 h-5" /> RPC Console
          </a>
        </div>
      </div>
    </div>
  );
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export default MinimaNodeStatus;