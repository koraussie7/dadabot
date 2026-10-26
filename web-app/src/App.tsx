import { useState } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { BlockCanvas } from '@agentmesh/affine-adapter/ui/BlockCanvas'
import { createInbox, createChangeRequest, applyDecision, createMemoryAuditLogger } from '@agentmesh/busabase-adapter'
import { runPipeline } from '@agentmesh/proposal-bridge'
import { createWorkspace, DADABOT_SCHEMAS } from '@agentmesh/affine-adapter'

// Small style helper for the NavBar download buttons. Each OS button gets
// its own accent color so they read as a primary action group.
function downloadBtnStyle(accent: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.35rem 0.75rem',
    color: accent,
    border: '1px solid ' + accent,
    borderRadius: '6px',
    textDecoration: 'none',
    fontSize: '0.8rem',
    fontWeight: 600,
    background: 'transparent',
  }
}

function NavBar() {
  const location = useLocation()
  return (
    <nav style={{ padding: '1rem', borderBottom: '1px solid #333', display: 'flex', gap: '1rem', alignItems: 'center' }}>
      <Link to="/console" style={{ color: location.pathname === '/console' ? '#61dafb' : '#fff' }}>Console</Link>
      <Link to="/inbox" style={{ color: location.pathname === '/inbox' ? '#61dafb' : '#fff' }}>Inbox</Link>
      <Link to="/canvas" style={{ color: location.pathname === '/canvas' ? '#61dafb' : '#fff' }}>Canvas</Link>
      <span style={{ flex: 1 }} />
      <a
        href="https://bot.muhanai.com"
        target="_blank"
        rel="noopener noreferrer"
        title="DadaBot - Local-First AI Agent OS"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: '#06b6d4', textDecoration: 'none', fontWeight: 600 }}
      >
        <svg width="22" height="22" viewBox="0 0 192 192" aria-hidden="true">
          <rect width="192" height="192" rx="36" fill="#0f172a" />
          <circle cx="96" cy="76" r="28" fill="#06b6d4" />
          <rect x="68" y="104" width="56" height="40" rx="8" fill="#06b6d4" />
          <circle cx="96" cy="76" r="14" fill="#0f172a" />
        </svg>
        DadaBot
        <span style={{ fontSize: '0.65rem', color: '#888', border: '1px solid #06b6d4', borderRadius: '4px', padding: '0.05rem 0.3rem' }}>NEW</span>
      </a>
      {/* Dadabot client download buttons. URLs go through the GitHub Releases
          "latest" page so the version is always current; once the user lands
          there they pick the platform-specific asset. */}
      <a
        href="https://github.com/koraussie7/dadabot/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        download
        style={downloadBtnStyle('#06b6d4')}
        title="Download dadabot-cli for macOS (universal)"
      >
        macOS
      </a>
      <a
        href="https://github.com/koraussie7/dadabot/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        download
        style={downloadBtnStyle('#a78bfa')}
        title="Download dadabot-cli for Windows (x86_64)"
      >
        Windows
      </a>
      <a
        href="https://github.com/koraussie7/dadabot/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        download
        style={downloadBtnStyle('#34d399')}
        title="Download dadabot-cli for Linux (x86_64)"
      >
        Linux
      </a>
    </nav>
  )
}

function ConsolePage() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Array<{role: 'user' | 'assistant', content: string}>>([])
  const [proposalId, setProposalId] = useState(0)
  const [chatMode, setChatMode] = useState<'command' | 'chat'>('command')

  const audit = createMemoryAuditLogger()

  const handleChatSubmit = async (content: string) => {
    if (!content.trim()) return
    setMessages(prev => [...prev, {role: 'user', content}])
    setInput('')
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'sk-test-key-for-dev'
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model: 'gpt-4o-mini', messages: [{role: 'user', content}], temperature: 0.7}),
    })
    if (!response.ok) {
      const errTxt = await response.text()
      setMessages(prev => [...prev, {role: 'assistant', content: `❌ LLM 오류: ${errTxt}`}])
      return
    }
    const data = await response.json()
    const assistantMsg = data.choices[0]?.message?.content ?? '❌ 응답 없음'
    setMessages(prev => [...prev, {role: 'assistant', content: assistantMsg}])
  }

  // ── 기존 파이프라인 실행 (명령어 모드) ────────────────────────
  const handlePipelineSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    const nextProposalId = proposalId + 1
    setProposalId(nextProposalId)
    const proposal = {
      id: `prop-${nextProposalId}`,
      kind: 'file_edit' as const,
      files: [{path: 'example.txt', content: input}],
      confidence: 0.8,
      reversible: true,
      rationale: 'User requested via console',
    }
    setInput('')
    try {
      const result = await runPipeline(
        proposal,
        {inbox: createInbox(), workspace: null as any, audit, autoMergeAcknowledged: true},
        {awaitDecision: async () => 'approve', executor: {apply: async () => {}}}
      )
      setMessages(prev => [...prev, {role: 'assistant', content: `✅ Applied: ${result.status}`}])
    } catch (err: any) {
      setMessages(prev => [...prev, {role: 'assistant', content: `❌ Error: ${err.message || '알 수 없는 에러'}`}])
    }
  }

  // ── 모드 전환 ────────────────────────────────────────────────
  const toggleMode = () => setChatMode(prev => prev === 'command' ? 'chat' : 'command')

  return (
    <div style={{ padding: '2rem', textAlign: 'left', maxWidth: '800px', margin: '0 auto' }}>
      <h2>DadaBot Console</h2>
      <form onSubmit={chatMode === 'command' ? handlePipelineSubmit : handleChatSubmit} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={chatMode === 'chat' ? '메시지를 입력하세요...' : 'Type a command (e.g., create file hello.txt)...'}
          style={{ flex: 1, padding: '0.5rem', fontSize: '1rem' }}
        />
        <button type="submit" style={{ padding: '0.5rem 1rem' }}>Run</button>
      </form>
      <div style={{ 
        height: '300px', 
        overflow: 'auto', 
        background: '#1a1a1a', 
        padding: '1rem', 
        borderRadius: '4px',
        textAlign: 'left',
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap'
      }}>
        {output.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  )
}

function InboxPage() {
  const inbox = createInbox()
  const [items, setItems] = useState<any[]>([])

  const refresh = () => {
    setItems(inbox.filter())
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'left', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2>Change Request Inbox</h2>
        <button onClick={refresh}>Refresh</button>
      </div>
      {items.length === 0 ? (
        <p style={{ color: '#888' }}>No pending change requests.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #333' }}>
              <th style={{ padding: '0.5rem' }}>ID</th>
              <th style={{ padding: '0.5rem' }}>Title</th>
              <th style={{ padding: '0.5rem' }}>Risk</th>
              <th style={{ padding: '0.5rem' }}>Status</th>
              <th style={{ padding: '0.5rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{item.id.slice(0, 8)}...</td>
                <td style={{ padding: '0.5rem' }}>{item.title}</td>
                <td style={{ padding: '0.5rem' }}>
                  <span style={{ 
                    padding: '0.1rem 0.5rem', 
                    borderRadius: '4px',
                    background: item.risk === 'critical' ? '#ff4444' : item.risk === 'high' ? '#ff8800' : '#00aa00',
                    color: '#fff',
                    fontSize: '0.7rem'
                  }}>
                    {item.risk}
                  </span>
                </td>
                <td style={{ padding: '0.5rem' }}>{item.status}</td>
                <td style={{ padding: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                  <button 
                    onClick={() => inbox.approve(item.id)}
                    style={{ background: '#00aa00', color: '#fff', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px' }}
                  >
                    ✅ Approve
                  </button>
                  <button 
                    onClick={() => inbox.reject(item.id)}
                    style={{ background: '#ff4444', color: '#fff', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px' }}
                  >
                    ❌ Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CanvasPage() {
  const [inbox] = useState(() => createInbox())
  const [workspace] = useState(() => createWorkspace({
    id: 'dadabot-console',
    schema: DADABOT_SCHEMAS,
    persistence: 'memory'
  }))

  return (
    <div style={{ padding: '2rem', height: 'calc(100vh - 120px)' }}>
      <h2>Block Canvas</h2>
      <BlockCanvas 
        workspace={workspace}
        onApprove={(block) => inbox.approve(block.props.changeRequestId as string)}
        onReject={(block) => inbox.reject(block.props.changeRequestId as string)}
      />
    </div>
  )
}


function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#1a1a1a', color: '#fff' }}>
      <NavBar />
      <Routes>
        <Route path="/console" element={<ConsolePage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/canvas" element={<CanvasPage />} />
        <Route path="/" element={<ConsolePage />} />
      </Routes>
    </div>
  )
}

export default App