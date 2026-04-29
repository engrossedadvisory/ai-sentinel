import { useState, useEffect } from 'react'
import { api } from '../api/client'

const NAV_ITEMS = [
  { id: 'dashboard',   icon: '◈', label: 'Dashboard'      },
  { id: 'agents',      icon: '⬡', label: 'Agent Registry' },
  { id: 'policies',    icon: '⊟', label: 'Policies'       },
  { id: 'activities',  icon: '≋', label: 'Activity Feed'  },
  { id: 'detections',  icon: '◎', label: 'Detections'     },
  { id: 'mitigations', icon: '⊗', label: 'Mitigations'    },
  { id: 'brains',      icon: '⊛', label: 'Brain Center'   },
]

const PROVIDER_COLORS = {
  claude: '#06b6d4',
  ollama: '#10b981',
  openai: '#8b5cf6',
  none:   '#64748b',
}

export default function Sidebar({ active, onNav, wsConnected }) {
  const [badges, setBadges]   = useState({})
  const [aiStatus, setAiStatus] = useState(null)

  useEffect(() => {
    const loadBadges = async () => {
      try {
        const [stats, recs] = await Promise.all([api.getStats(), api.getRecommendations('pending').catch(() => [])])
        setBadges({
          agents:      stats.unauthorized_agents  || 0,
          detections:  stats.new_detections       || 0,
          mitigations: stats.pending_mitigations  || 0,
          activities:  stats.open_violations      || 0,
          brains:      recs.length || 0,
        })
      } catch {}
    }
    const loadAI = async () => {
      try { setAiStatus(await fetch('/api/ai/status').then(r => r.json())) } catch {}
    }
    loadBadges(); loadAI()
    const t = setInterval(loadBadges, 15000)
    return () => clearInterval(t)
  }, [])

  const aiColor = PROVIDER_COLORS[aiStatus?.provider] || PROVIDER_COLORS.none

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>◈ AI SENTINEL</h1>
        <p>AI acts. SENTINEL answers.</p>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">Navigation</div>
        {NAV_ITEMS.map(item => (
          <div
            key={item.id}
            className={`nav-item ${active === item.id ? 'active' : ''}`}
            onClick={() => onNav(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
            {badges[item.id] > 0 && (
              <span className={`nav-badge ${item.id === 'activities' ? 'warn' : ''}`}>
                {badges[item.id]}
              </span>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {/* Multi-brain status */}
        {aiStatus && (
          <div style={{ marginBottom: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 6 }}>
              AI Brains
            </div>
            {aiStatus.enabled ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-cyan)', boxShadow: '0 0 6px var(--accent-cyan)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 700 }}>
                    {aiStatus.brains_active}/{aiStatus.brains_total} active
                  </span>
                </div>
                {/* Mini brain dots */}
                <div style={{ display: 'flex', gap: 5 }}>
                  {['◇','◉','△','▣','⊛'].map((icon, i) => (
                    <span key={i} style={{ fontSize: 11, color: i < aiStatus.brains_active ? 'var(--accent-cyan)' : 'var(--text-muted)', opacity: i < aiStatus.brains_active ? 1 : 0.4 }}>
                      {icon}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Rule-based only</span>
              </div>
            )}
          </div>
        )}
        {/* WebSocket status */}
        <div className="ws-status">
          <div className={`ws-dot ${wsConnected ? 'connected' : ''}`} />
          <span>{wsConnected ? 'Live updates on' : 'Connecting…'}</span>
        </div>
      </div>
    </aside>
  )
}
