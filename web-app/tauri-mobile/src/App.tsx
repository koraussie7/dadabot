import { useEffect, useState } from 'react'
import { InboxPanel } from './InboxPanel'

function App() {
  const [isTauri, setIsTauri] = useState(false)
  const [deviceInfo, setDeviceInfo] = useState<any>(null)
  const [notificationPermission, setNotificationPermission] = useState<'default' | 'granted' | 'denied'>('default')

  useEffect(() => {
    // Tauri 환경 감지
    const checkTauri = async () => {
      if (window.__TAURI__) {
        setIsTauri(true)
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const info = await invoke('get_device_info')
          setDeviceInfo(info)
        } catch (e) {
          console.warn('Device info unavailable:', e)
        }
        
        // 알림 권한 확인
        if ('Notification' in window) {
          setNotificationPermission(Notification.permission)
        }
      } else {
        setIsTauri(false)
      }
    }
    checkTauri()
  }, [])

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  const testBiometric = async () => {
    if (!window.__TAURI__) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke('biometric_auth', { reason: 'DadaBot에 로그인합니다' })
      alert(`Biometric auth: ${result ? 'Success' : 'Failed'}`)
    } catch (e) {
      alert(`Biometric error: ${e}`)
    }
  }

  const testNotification = async () => {
    if (!window.__TAURI__) return
    try {
      await window.__TAURI__.notification.send({
        title: 'DadaBot',
        body: '테스트 알림입니다',
      })
    } catch (e) {
      alert(`Notification error: ${e}`)
    }
  }

  const openExternal = async () => {
    if (!window.__TAURI__) return
    try {
      await window.__TAURI__.opener.openUrl('https://dadabot.dev')
    } catch (e) {
      alert(`Open URL error: ${e}`)
    }
  }

  if (typeof window === 'undefined') return null

  return (
    <div style={{
      minHeight: '100vh',
      background: '#1a1a1a',
      color: '#fff',
      padding: '1rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <header style={{ 
        padding: '1rem', 
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>DadaBot Mobile</h1>
        <span style={{
          padding: '0.25rem 0.5rem',
          borderRadius: '4px',
          background: isTauri ? '#00aa00' : '#ff8800',
          color: '#fff',
          fontSize: '0.75rem'
        }}>
          {isTauri ? 'Tauri Mobile' : 'Web Browser'}
        </span>
      </header>

      <main style={{ padding: '1rem', maxWidth: '600px', margin: '0 auto' }}>
        {deviceInfo && (
          <section style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>기기 정보</h2>
            <pre style={{
              background: '#2a2a2a',
              padding: '1rem',
              borderRadius: '8px',
              fontSize: '0.8rem',
              overflow: 'auto'
            }}>
              {JSON.stringify(deviceInfo, null, 2)}
            </pre>
          </section>
        )}

        <section style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>알림 권한</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ 
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              background: notificationPermission === 'granted' ? '#00aa00' : 
                          notificationPermission === 'denied' ? '#ff4444' : '#ff8800',
              color: '#fff',
              fontSize: '0.75rem'
            }}>
              {notificationPermission}
            </span>
            {notificationPermission !== 'granted' && (
              <button 
                onClick={requestNotificationPermission}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#6366f1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                권한 요청
              </button>
            )}
          </div>
        </section>

        <section style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>네이티브 기능 테스트</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button 
              onClick={testBiometric}
              style={{
                padding: '0.75rem 1rem',
                background: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              🔐 생체 인증 테스트
            </button>
            <button 
              onClick={testNotification}
              style={{
                padding: '0.75rem 1rem',
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              🔔 알림 테스트
            </button>
            <button 
              onClick={openExternal}
              style={{
                padding: '0.75rem 1rem',
                background: '#f59e0b',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              🌐 외부 링크 열기
            </button>
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>웹 앱 임베드</h2>
          <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            프로덕션에서는 iframe으로 웹 앱을 임베드합니다.
          </p>
          <iframe 
            src="https://dadabot.dev" 
            style={{
              width: '100%',
              height: '400px',
              border: '1px solid #333',
              borderRadius: '8px',
              background: '#1a1a1a'
            }}
            title="DadaBot Web App"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-storage-access-by-user-activation"
          />
                </section>
                <InboxPanel />
              </main>
            </div>
          )
        }
        export default App