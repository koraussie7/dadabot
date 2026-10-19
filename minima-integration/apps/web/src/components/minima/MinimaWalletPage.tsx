/**
 * MinimaWalletPage.tsx — Wallet UI for Minima
 * Dark theme: #09090b / #141418 / #14ebc0
 */
import React, { useState, useEffect } from "react";
import { useMinima } from "../../hooks/useMinima";
import { Wallet, Send, Receive, RefreshCw, Activity, Copy, QrCode } from "lucide-react";

export function MinimaWalletPage() {
  const { client, identity, balance, transactions, loading, error, sendPayment, refresh } = useMinima();
  const [sendModal, setSendModal] = useState(false);
  const [sendForm, setSendForm] = useState({ to: "", amount: "", token: "MINIMA" });

  useEffect(() => {
    // Initialize on mount
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await sendPayment(sendForm.to, sendForm.amount, sendForm.token);
      setSendModal(false);
      setSendForm({ to: "", amount: "", token: "MINIMA" });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Send failed");
    }
  };

  const copyAddress = () => {
    navigator.clipboard.writeText("mock-address");
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[#14ebc0] to-[#06b6d4] bg-clip-text text-transparent">
            Minima Wallet
          </h1>
          <button onClick={refresh} disabled={loading} className="p-2 hover:bg-[#141418] rounded-lg transition">
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Balance Card */}
        <div className="bg-[#141418] rounded-xl p-6 border border-[#27272a]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[#71717a] text-sm">MINIMA Balance</span>
            <span className="text-[#14ebc0] font-mono text-sm">MINIMA</span>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-bold">1,234.56</span>
            <span className="text-[#71717a]">MINIMA</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-[#71717a]">
            <span>≈ $1,234.56 USD</span>
            <span className="text-[#14ebc0]">● Synced</span>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-3 gap-3">
          <button onClick={() => setSendModal(true)} className="bg-[#14ebc0] text-[#09090b] font-semibold py-3 rounded-xl hover:opacity-90 transition flex items-center justify-center gap-2">
            <Send className="w-5 h-5" /> Send
          </button>
          <button onClick={copyAddress} className="bg-[#1f1f1f] text-white font-semibold py-3 rounded-xl hover:bg-[#27272a] transition flex items-center justify-center gap-2">
            <Receive className="w-5 h-5" /> Receive
          </button>
          <button className="bg-[#1f1f1f] text-white font-semibold py-3 rounded-xl hover:bg-[#27272a] transition flex items-center justify-center gap-2">
            <QrCode className="w-5 h-5" /> QR
          </button>
        </div>

        {/* Transaction History */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <div className="bg-[#141418] rounded-xl border border-[#27272a] overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-[#71717a]">Loading...</div>
            ) : error ? (
              <div className="p-8 text-center text-red-500">{error}</div>
            ) : transactions.length === 0 ? (
              <div className="p-8 text-center text-[#71717a]">No transactions yet</div>
            ) : (
              <div className="divide-y divide-[#27272a]">
                {transactions.map((tx: any) => (
                  <div key={tx.txid} className="p-4 flex items-center justify-between hover:bg-[#1f1f1f]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#14ebc0]/10 flex items-center justify-center">
                        <Activity className="w-5 h-5 text-[#14ebc0]" />
                      </div>
                      <div>
                        <p className="font-medium">{tx.type === "send" ? "Sent" : "Received"}</p>
                        <p className="text-xs text-[#71717a]">{tx.txid?.slice(0, 12)}...</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-mono font-semibold ${tx.type === "send" ? "text-red-400" : "text-[#14ebc0]"}`}>
                        {tx.type === "send" ? "-" : "+"} {tx.amount} MINIMA
                      </p>
                      <p className="text-xs text-[#71717a]">{new Date(tx.timestamp).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Send Modal */}
      {sendModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#141418] rounded-2xl p-6 w-full max-w-md border border-[#27272a]">
            <h2 className="text-xl font-bold mb-4">Send MINIMA</h2>
            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label className="block text-sm text-[#71717a] mb-1">To Address</label>
                <input
                  type="text"
                  value={sendForm.to}
                  onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white placeholder-[#71717a] focus:border-[#14ebc0] focus:outline-none"
                  placeholder="Recipient address"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-[#71717a] mb-1">Amount</label>
                <input
                  type="number"
                  step="0.000001"
                  value={sendForm.amount}
                  onChange={(e) => setSendForm({ ...sendForm, amount: e.target.value })}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white placeholder-[#71717a] focus:border-[#14ebc0] focus:outline-none"
                  placeholder="0.000000"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-[#71717a] mb-1">Token</label>
                <select
                  value={sendForm.token}
                  onChange={(e) => setSendForm({ ...sendForm, token: e.target.value })}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-white focus:border-[#14ebc0] focus:outline-none"
                >
                  <option value="MINIMA">MINIMA</option>
                  <option value="DADA">DADA</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setSendModal(false)}
                  className="flex-1 bg-[#1f1f1f] text-white py-3 rounded-xl font-semibold hover:bg-[#27272a] transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-[#14ebc0] text-[#09090b] py-3 rounded-xl font-semibold hover:opacity-90 transition"
                >
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default MinimaWalletPage;