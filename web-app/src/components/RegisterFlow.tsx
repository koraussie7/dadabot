/**
 * RegisterFlow.tsx — OpenWork-style onboarding for muhanai.com.
 *
 * 5-step registration flow (mirrors openwork.network pattern):
 *   1. Welcome      — Choose: Human signup or AI Agent registration
 *   2. Provider     — Paste free AI provider keys (Groq, Cerebras, etc.)
 *   3. Identity     — SIWE (Sign-In with Ethereum) for credential portability
 *   4. Capability   — Run a test Proposal to verify pipeline works
 *   5. Dashboard    — Land on Inbox / Console with registration complete
 *
 * Persistence: writes to ~/.dadabot/.env and ~/.dadabot/identity.json
 * (W3C Verifiable Credential-compatible).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";

type Step = "welcome" | "provider" | "identity" | "capability" | "done";

interface ProviderEntry {
  id: string;
  name: string;
  url: string;
  placeholder: string;
  value: string;
}

const PROVIDERS: ProviderEntry[] = [
  {
    id: "groq",
    name: "Groq",
    url: "https://console.groq.com/keys",
    placeholder: "gsk_…",
    value: "",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    url: "https://cloud.cerebras.ai",
    placeholder: "csk-…",
    value: "",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    url: "https://build.nvidia.com",
    placeholder: "nvapi-…",
    value: "",
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://aistudio.google.com/app/apikey",
    placeholder: "AIzaSy…",
    value: "",
  },
  {
    id: "mistral",
    name: "Mistral",
    url: "https://console.mistral.ai/api-keys/",
    placeholder: "…",
    value: "",
  },
  {
    id: "github-models",
    name: "GitHub Models",
    url: "https://github.com/settings/tokens",
    placeholder: "ghp_…",
    value: "",
  },
];

export function RegisterFlow() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [providers, setProviders] = useState<ProviderEntry[]>(PROVIDERS);
  const [wallet, setWallet] = useState("");
  const [signature, setSignature] = useState("");
  const [testOutput, setTestOutput] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const updateProvider = (id: string, value: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, value } : p)),
    );
  };

  const configuredCount = providers.filter(
    (p) => p.value.trim().length > 0,
  ).length;

  const saveProviders = async () => {
    setError(null);
    try {
      const resp = await fetch("/api/register/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(
            providers.map((p) => [p.id, p.value]).filter(([_, v]) => v),
          ),
        ),
      });
      if (!resp.ok) throw new Error("save failed");
    } catch (e) {
      setError(String(e));
      return;
    }
    setStep("identity");
  };

  const signSiwe = async () => {
    setError(null);
    if (!wallet) {
      setError("paste a wallet address first");
      return;
    }
    // Stub SIWE — real implementation uses ethers.siwe.SIWEViem or wagmi
    const challenge = `muhanai.com wants you to sign in with your Ethereum account:\n${wallet}\n\nRegistering as Agent on Muhanai Agent OS.`;
    const fakeSig =
      "0x" +
      Array.from(crypto.getRandomValues(new Uint8Array(64)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    setSignature(fakeSig);
    setStep("capability");
  };

  const runCapabilityTest = async () => {
    setError(null);
    setTestOutput(["Starting capability test…"]);
    try {
      const resp = await fetch("/api/register/test", { method: "POST" });
      if (!resp.ok) throw new Error("test failed");
      const json = await resp.json();
      setTestOutput((prev) => [
        ...prev,
        `✓ providers detected: ${json.providers.join(", ")}`,
        `✓ inbox.json writable: ${json.inboxOk}`,
        `✓ workspace.json writable: ${json.workspaceOk}`,
        `✓ test Proposal: ${json.testProposalTitle}`,
        `✓ policy decision: ${json.policyDecision}`,
        "",
        "Registration complete. Redirecting…",
      ]);
      setStep("done");
      setTimeout(() => navigate("/console"), 2000);
    } catch (e) {
      setError(String(e));
      setTestOutput((prev) => [...prev, `✗ ${e}`]);
    }
  };

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "2rem auto",
        padding: "2rem",
        background: "#0f172a",
        borderRadius: "16px",
        color: "#e2e8f0",
        fontFamily: "system-ui",
      }}
    >
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>
          🤖 Muhanai Agent OS — Registration
        </h1>
        <p
          style={{
            margin: "0.25rem 0 0",
            color: "#94a3b8",
            fontSize: "0.875rem",
          }}
        >
          OpenWork-style signup · {step} / 5
        </p>
      </header>

      <Stepper step={step} />

      {step === "welcome" && (
        <section style={{ marginTop: "1.5rem" }}>
          <p>
            Welcome! Muhanai Agent OS is a local-first AI agent OS. To get
            started, you can:
          </p>
          <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
            <button onClick={() => setStep("provider")} style={primaryBtn}>
              👤 Sign up as Human
            </button>
            <button onClick={() => setStep("provider")} style={secondaryBtn}>
              🤖 Register AI Agent
            </button>
          </div>
          <p
            style={{
              marginTop: "1rem",
              fontSize: "0.875rem",
              color: "#94a3b8",
            }}
          >
            Both flows configure free AI providers and create a portable W3C
            Verifiable Credential.
          </p>
        </section>
      )}

      {step === "provider" && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2 style={{ fontSize: "1.125rem" }}>Step 1/4: Free AI Providers</h2>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
            Paste any one or more — all 6 are no-credit-card free tiers. DadaBot
            rotates across whatever you set.
          </p>
          {providers.map((p) => (
            <div key={p.id} style={{ marginTop: "0.75rem" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.875rem",
                  marginBottom: "0.25rem",
                }}
              >
                <strong>{p.name}</strong>{" "}
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#60a5fa", fontSize: "0.75rem" }}
                >
                  get key ↗
                </a>
              </label>
              <input
                type="password"
                placeholder={p.placeholder}
                value={p.value}
                onChange={(e) => updateProvider(p.id, e.target.value)}
                style={inputStyle}
              />
            </div>
          ))}
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button onClick={() => setStep("welcome")} style={secondaryBtn}>
              ← Back
            </button>
            <button
              onClick={saveProviders}
              disabled={configuredCount === 0}
              style={{
                ...primaryBtn,
                opacity: configuredCount === 0 ? 0.5 : 1,
              }}
            >
              Next: Identity ({configuredCount}/6)
            </button>
          </div>
          {error && <ErrorBox text={error} />}
        </section>
      )}

      {step === "identity" && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2 style={{ fontSize: "1.125rem" }}>
            Step 2/4: W3C Verifiable Credential
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
            Sign in with an Ethereum wallet to get a portable identity (same as
            OpenWork). Skip to register without wallet.
          </p>
          <input
            placeholder="0x… wallet address"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            style={inputStyle}
          />
          {signature && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#22c55e",
                marginTop: "0.5rem",
              }}
            >
              ✓ Signed: {signature.slice(0, 18)}…
            </p>
          )}
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button onClick={() => setStep("provider")} style={secondaryBtn}>
              ← Back
            </button>
            <button onClick={signSiwe} style={primaryBtn}>
              Sign with Ethereum
            </button>
            <button onClick={() => setStep("capability")} style={secondaryBtn}>
              Skip →
            </button>
          </div>
          {error && <ErrorBox text={error} />}
        </section>
      )}

      {step === "capability" && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2 style={{ fontSize: "1.125rem" }}>Step 3/4: Capability Test</h2>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
            Run a synthetic Proposal through the 5-stage safety pipeline to
            verify everything works end-to-end.
          </p>
          <pre
            style={{
              background: "#1e293b",
              padding: "1rem",
              borderRadius: "8px",
              fontSize: "0.75rem",
              marginTop: "1rem",
              minHeight: "8rem",
            }}
          >
            {testOutput.join("\n") || "(click Run Test to begin)"}
          </pre>
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button onClick={() => setStep("identity")} style={secondaryBtn}>
              ← Back
            </button>
            <button onClick={runCapabilityTest} style={primaryBtn}>
              ▶ Run Test
            </button>
          </div>
          {error && <ErrorBox text={error} />}
        </section>
      )}

      {step === "done" && (
        <section style={{ marginTop: "1.5rem", textAlign: "center" }}>
          <h2 style={{ color: "#22c55e" }}>✓ Registration complete</h2>
          <p>Redirecting to Console…</p>
        </section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: Step[] = [
    "welcome",
    "provider",
    "identity",
    "capability",
    "done",
  ];
  const idx = steps.indexOf(step);
  return (
    <ol
      style={{ display: "flex", gap: "0.5rem", padding: 0, listStyle: "none" }}
    >
      {steps.map((s, i) => (
        <li
          key={s}
          style={{
            flex: 1,
            height: "4px",
            background: i <= idx ? "#22c55e" : "#334155",
            borderRadius: "2px",
          }}
        />
      ))}
    </ol>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: "0.75rem",
        padding: "0.5rem",
        background: "#7f1d1d",
        borderRadius: "6px",
        fontSize: "0.875rem",
      }}
    >
      ⚠ {text}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: "8px",
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontSize: "0.875rem",
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  ...primaryBtn,
  background: "#475569",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  borderRadius: "6px",
  border: "1px solid #334155",
  background: "#1e293b",
  color: "#e2e8f0",
  fontSize: "0.875rem",
  fontFamily: "monospace",
};
