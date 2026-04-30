import { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import AgentRegistry from './components/AgentRegistry'
import PolicyManager from './components/PolicyManager'
import ActivityFeed from './components/ActivityFeed'
import DetectionPanel from './components/DetectionPanel'
import MitigationCenter from './components/MitigationCenter'
import BrainCenter from './components/BrainCenter'
import { setDemoMode, getDemoMode } from './api/client'

// Sync module flag with persisted value immediately at load time
// (before any component renders and makes API calls)
const _persistedDemo = localStorage.getItem('sentinel_demo_mode')
setDemoMode(_persistedDemo === null ? true : _persistedDemo === 'true')

let alertId = 0
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

export default function App() {
  const [page,       setPage]      = useState('dashboard')
  const [demoMode,   setDemoModeState] = useState(() => {
    // Persist demo/live choice across page refreshes
    const saved = localStorage.getItem('sentinel_demo_mode')
    return saved === null ? true : saved === 'true'
  })
  const [navFilter,  setNavFilter] = useState({})
  // navKey increments on every onNav call — forces child to remount with fresh initialFilter
  const [navKey,     setNavKey]    = useState(0)
  const [wsConnected, setWsConnected] = useState(false)
  const [wsEvent,     setWsEvent]     = useState(null)
  const [alerts,      setAlerts]      = useState([])
  const wsRef          = useRef(null)
  const reconnectTimer = useRef(null)

  // Update module-level flag synchronously inside the setter so child effects
  // always see the correct value when they fire on the same render cycle.
  const toggleDemo = useCallback(() => {
    setDemoModeState(prev => {
      const next = !prev
      setDemoMode(next)                                    // sync module flag
      localStorage.setItem('sentinel_demo_mode', String(next))  // persist
      return next
    })
  }, [])

  // Navigate to a page with optional pre-loaded filter.
  // Incrementing navKey causes the target component to remount (fresh initialFilter).
  const onNav = useCallback((targetPage, filter = {}) => {
    setNavFilter(filter)
    setNavKey(k => k + 1)
    setPage(targetPage)
  }, [])

  const pushAlert = useCallback((type, message) => {
    const id = ++alertId
    setAlerts(prev => [...prev, { id, type, message }])
    setTimeout(() => setAlerts(prev => prev.filter(a => a.id !== id)), 5000)
  }, [])

  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.onopen  = () => {
        setWsConnected(true)
        if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          setWsEvent(msg)
          if      (msg.type === 'policy_violation')   pushAlert('danger',  `Policy violation: ${msg.data.policy} — ${msg.data.agent_id}`)
          else if (msg.type === 'new_detection')       pushAlert('warning', `New detection: ${msg.data.detection_type} via ${msg.data.source}`)
          else if (msg.type === 'agent_status_change') pushAlert('info',    `Agent ${msg.data.name} → ${msg.data.status}`)
          else if (msg.type === 'governance_alert')    pushAlert('danger',  `Alert: ${msg.data.message}`)
        } catch {}
      }
      ws.onclose = () => { setWsConnected(false); reconnectTimer.current = setTimeout(connectWs, 3000) }
      ws.onerror = () => ws.close()
    } catch { reconnectTimer.current = setTimeout(connectWs, 3000) }
  }, [pushAlert])

  useEffect(() => {
    connectWs()
    return () => { wsRef.current?.close(); if (reconnectTimer.current) clearTimeout(reconnectTimer.current) }
  }, [connectWs])

  const PAGE_PROPS = { wsEvent, onAlert: pushAlert, demoMode }

  return (
    <div className="app">
      {/* Sidebar uses onNav so navKey increments and the target page remounts cleanly */}
      <Sidebar active={page} onNav={(p) => onNav(p)} wsConnected={wsConnected} />

      <main className="main-content">
        {page === 'dashboard'   && <Dashboard      key={navKey} {...PAGE_PROPS} onNav={onNav} onToggleDemo={toggleDemo} />}
        {page === 'agents'      && <AgentRegistry  key={navKey} {...PAGE_PROPS} initialFilter={navFilter} />}
        {page === 'policies'    && <PolicyManager  key={navKey} onAlert={pushAlert} demoMode={demoMode} />}
        {page === 'activities'  && <ActivityFeed   key={navKey} {...PAGE_PROPS} initialFilter={navFilter} />}
        {page === 'detections'  && <DetectionPanel key={navKey} {...PAGE_PROPS} initialFilter={navFilter} />}
        {page === 'mitigations' && <MitigationCenter key={navKey} {...PAGE_PROPS} initialFilter={navFilter} />}
        {page === 'brains'      && <BrainCenter    key={navKey} onAlert={pushAlert} />}
      </main>

      <div className="alert-container">
        {alerts.map(a => (
          <div key={a.id} className={`alert-toast ${a.type}`}>
            <span style={{ fontSize: 16 }}>
              {a.type === 'danger' ? '◬' : a.type === 'warning' ? '◈' : a.type === 'success' ? '◉' : '◦'}
            </span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                {a.type === 'danger' ? 'Alert' : a.type === 'warning' ? 'Warning' : a.type === 'success' ? 'Success' : 'Info'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{a.message}</div>
            </div>
            <button className="btn btn-ghost btn-sm btn-icon" style={{ marginLeft: 'auto' }}
              onClick={() => setAlerts(p => p.filter(x => x.id !== a.id))}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
