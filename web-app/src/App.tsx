import { useState } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { BlockCanvas } from '@agentmesh/affine-adapter/ui/BlockCanvas'
import { createInbox, createChangeRequest, applyDecision, createMemoryAuditLogger } from '@agentmesh/busabase-adapter'
import { runPipeline } from '@agentmesh/proposal-bridge'
import { createWorkspace, DADABOT_SCHEMAS } from '@agentmesh/affine-adapter'

function NavBar() {
  const location = useLocation()
  return (
    <nav style={{ padding: '1rem', borderBottom: '1px solid #333', display: 'flex', gap: '1rem' }}>
      <Link to="/console" style={{ color: location.pathname === '/console' ? '#61dafb' : '#fff' }}>Console</Link>
      <Link to="/inbox" style={{ color: location.pathname === '/inbox' ? '#61dafb' : '#fff' }}>Inbox</Link>
      <Link to="/canvas" style={{ color: location.pathname === '/canvas' ? '#61dafb' : '#fff' }}>Canvas</Link>
    </nav>
  )
}

function ConsolePage() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState<string[]>([])
  const [proposalId, setProposalId] = useState(0)

  const audit = createMemoryAuditLogger()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    const proposal = {
      id: `prop-${++proposalId}`,
      kind: 'file_edit' as const,
      files: [{ path: 'example.txt', content: input }],
      confidence: 0.8,
      reversible: true,
      rationale: 'User requested via console',
    }

    setOutput(prev => [...prev, `> ${input}`])
    setInput('')

    try {
      const result = await runPipeline(
        proposal,
        {
          inbox: createInbox(),
          workspace: null as any,
          audit,
          autoMergeAcknowledged: true,
        },
        {
          awaitDecision: async () => 'approve',
          executor: { apply: async () => {} },
        }
      )
      setOutput(prev => [...prev, `✅ Applied: ${result.status}`])
    } catch (err) {
      setOutput(prev => [...prev, `❌ Error: ${(err as Error).message}`])
    }
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'left', maxWidth: '800px', margin: '0 auto' }}>
      <h2>DadaBot Console</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a command (e.g., 'create file hello.txt')..."
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

function NavBar() {
  const location = useLocation()
  return (
    <nav style={{ padding: '1rem', borderBottom: '1px solid #333', display: 'flex', gap: '1rem' }}>
      <Link to="/console" style={{ color: location.pathname === '/console' ? '#61dafb' : '#fff' }}>Console</Link>
      <Link to="/inbox" style={{ color: location.pathname === '/inbox' ? '#61dafb' : '#fff' }}>Inbox</Link>
      <Link to="/canvas" style={{ color: location.pathname === '/canvas' ? '#61dafb' : '#fff' }}>Canvas</Link>
    </nav>
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