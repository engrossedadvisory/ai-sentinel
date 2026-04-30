import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'

const RISK_COLOR = (score) => {
  if (score >= 0.8) return '#dc2626'
  if (score >= 0.6) return '#ef4444'
  if (score >= 0.4) return '#f59e0b'
  return '#10b981'
}

export default function ActivityFeed({ wsEvent, onAlert, demoMode, initialFilter = {} }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({
    flagged:  initialFilter.flagged  || '',
    agent_id: initialFilter.agent_id || '',
    since:    initialFilter.since    || '',
  })
  const [liveItems, setLiveItems] = useState([])
  const feedRef = useRef(null)

  const load = async () => {
    try {
      const params = { limit: 100 }
      if (filter.flagged !== '') params.flagged = filter.flagged === 'true'
      if (filter.agent_id) params.agent_id = filter.agent_id
      if (filter.since)    params.since    = filter.since
      const data = await api.getActivities(params)
      setActivities(data)
    } catch (e) { onAlert('error', e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filter, demoMode])

  useEffect(() => {
    if (wsEvent?.type === 'new_activity') {
      const item = wsEvent.data
      setLiveItems(prev => [{ ...item, _live: true }, ...prev].slice(0, 20))
      setActivities(prev => [item, ...prev].slice(0, 200))
    }
  }, [wsEvent])

  const allItems = activities

  return (
    <div className="page">
      <div className="page-header">
        <h2>Activity Feed</h2>
        <p>Real-time stream of all AI agent activity with risk scoring and policy evaluation results</p>
      </div>

      <div className="toolbar">
        <select className="form-select" style={{ width: 160 }} value={filter.flagged} onChange={e => setFilter(p => ({ ...p, flagged: e.target.value }))}>
          <option value="">All Activities</option>
          <option value="true">Flagged Only</option>
          <option value="false">Clean Only</option>
        </select>
        <input
          className="form-input"
          style={{ width: 220 }}
          placeholder="Filter by agent ID…"
          value={filter.agent_id}
          onChange={e => setFilter(p => ({ ...p, agent_id: e.target.value }))}
        />
        {filter.since && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)', fontSize: 11, color: '#06b6d4' }}>
            ◷ From {new Date(filter.since).toLocaleTimeString()}
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 0, marginLeft: 4 }} onClick={() => setFilter(p => ({ ...p, since: '' }))}>✕</button>
          </div>
        )}
        <div className="toolbar-spacer" />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', animation: 'pulse 2s infinite' }} />
          Live
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
      </div>

      <div className="card" ref={feedRef} style={{ padding: 0, maxHeight: 'calc(100vh - 240px)', overflow: 'auto' }}>
        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : allItems.length === 0 ? (
          <div className="empty-state"><div className="icon">≋</div><p>No activities recorded yet</p></div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
              <tr>
                <th>Time</th><th>Agent</th><th>Type</th><th>Action</th>
                <th>Risk</th><th>Result</th><th>Flagged</th>
              </tr>
            </thead>
            <tbody>
              {allItems.map(a => (
                <tr key={a.id} style={a._live ? { animation: 'slideIn 0.3s ease' } : {}}>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>
                    {new Date(a.timestamp).toLocaleTimeString()}
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>
                    {a.agent_id?.slice(0, 24)}
                  </td>
                  <td>
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)' }}>
                      {a.activity_type}
                    </span>
                  </td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {a.action}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 90 }}>
                      <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${a.risk_score * 100}%`, background: RISK_COLOR(a.risk_score), borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: RISK_COLOR(a.risk_score), minWidth: 32, textAlign: 'right' }}>
                        {Math.round(a.risk_score * 100)}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge-${a.result === 'blocked' ? 'high' : a.result === 'warned' ? 'medium' : a.result === 'escalated' ? 'unknown' : 'active'}`}>
                      {a.result || 'allowed'}
                    </span>
                  </td>
                  <td>
                    {a.flagged ? (
                      <span style={{ color: 'var(--danger)', fontSize: 14 }} title="Flagged">⚑</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
