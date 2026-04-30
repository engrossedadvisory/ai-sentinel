import { useState, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { api, setDemoMode } from '../api/client'

const RISK_COLORS = { low: '#10b981', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' }

function StatCard({ label, value, sub, variant = 'default', onClick, clickable }) {
  return (
    <div
      className={`stat-card ${variant}`}
      onClick={onClick}
      style={{
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.12s, box-shadow 0.12s',
      }}
      onMouseEnter={e => { if (clickable) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)' }}}
      onMouseLeave={e => { if (clickable) { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}}
      title={clickable ? `View ${label} details` : undefined}
    >
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {clickable && (
        <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 10, color: 'var(--text-muted)', opacity: 0.6 }}>
          ↗ drill down
        </div>
      )}
    </div>
  )
}

// Custom chart tooltip
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#141d35', border: '1px solid #1e2d4a', borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, fontSize: 12 }}>
          {p.name}: <strong>{p.value}</strong>
        </div>
      ))}
      <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>Click to view activities</div>
    </div>
  )
}

// Custom pie label
const PieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#141d35', border: '1px solid #1e2d4a', borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ color: payload[0].payload.fill, fontSize: 12, fontWeight: 600 }}>
        {payload[0].name}: {payload[0].value} agents
      </div>
      <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>Click to filter agents</div>
    </div>
  )
}

export default function Dashboard({ wsEvent, onNav, demoMode, onToggleDemo }) {
  const [stats,      setStats]      = useState(null)
  const [chart,      setChart]      = useState([])
  const [violations, setViolations] = useState([])
  const [detections, setDetections] = useState([])

  // Explicitly sync the module flag then fetch — avoids any stale-closure race
  const load = async (dm = demoMode) => {
    try {
      setDemoMode(dm)
      const [s, c, v, d] = await Promise.all([
        api.getStats(),
        api.getActivityChart(24),
        api.getRecentViolations(8),
        api.getRecentDetections(5),
      ])
      setStats(s); setChart(c); setViolations(v); setDetections(d)
    } catch (e) { console.error('Dashboard load error:', e) }
  }

  useEffect(() => { load(demoMode) }, [demoMode])

  useEffect(() => {
    if (wsEvent && ['new_activity', 'policy_violation', 'new_detection', 'agent_status_change'].includes(wsEvent.type)) {
      load()
    }
  }, [wsEvent])

  const riskPieData = stats
    ? Object.entries(stats.risk_distribution)
        .map(([k, v]) => ({ name: k, value: v, fill: RISK_COLORS[k] || '#64748b' }))
        .filter(d => d.value > 0)
    : []

  const severityColor  = s => ({ low: '#10b981', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' }[s] || '#64748b')
  const confidenceColor = c => c > 0.85 ? '#ef4444' : c > 0.65 ? '#f59e0b' : '#3b82f6'

  // ── Drill-down handlers ───────────────────────────────────────────────────
  const drillAgents      = (filter = {}) => onNav('agents',      filter)
  const drillActivities  = (filter = {}) => onNav('activities',  filter)
  const drillDetections  = (filter = {}) => onNav('detections',  filter)
  const drillMitigations = (filter = {}) => onNav('mitigations', filter)

  const handleChartClick = (data) => {
    if (!data?.activePayload) return
    const bucket = chart.find(b => b.hour === data.activeLabel)
    if (bucket?.bucket_start) {
      drillActivities({ since: bucket.bucket_start })
    } else {
      drillActivities({})
    }
  }

  const handlePieClick = (data) => {
    if (data?.name) drillAgents({ risk_level: data.name })
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>Dashboard</h2>
          <p>Real-time overview of AI agent health, policy compliance, and threat posture</p>
        </div>

        {/* Demo / Live toggle */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '6px 14px', flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em' }}>
            DATA MODE
          </span>
          <button
            onClick={onToggleDemo}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px',
              borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              background: demoMode ? 'rgba(139,92,246,0.15)' : 'rgba(16,185,129,0.15)',
              color: demoMode ? '#8b5cf6' : '#10b981',
              outline: `1px solid ${demoMode ? '#8b5cf640' : '#10b98140'}`,
              transition: 'all 0.2s',
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: demoMode ? '#8b5cf6' : '#10b981',
              boxShadow: `0 0 6px ${demoMode ? '#8b5cf6' : '#10b981'}`,
              animation: !demoMode ? 'pulse 2s infinite' : 'none',
            }} />
            {demoMode ? '◈ DEMO' : '◉ LIVE'}
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {demoMode ? 'includes seeded data' : 'real agents only'}
          </span>
        </div>
      </div>

      {/* Stat cards — all clickable */}
      <div className="stats-grid" style={{ position: 'relative' }}>
        <StatCard label="Total Agents"    value={stats?.total_agents}        sub={`${stats?.active_agents ?? '—'} active`}       clickable onClick={() => drillAgents({})} />
        <StatCard label="Quarantined"     value={stats?.quarantined_agents}  sub="Isolated agents"       variant="danger"  clickable onClick={() => drillAgents({ status: 'quarantined' })} />
        <StatCard label="Unauthorized"    value={stats?.unauthorized_agents} sub="Require authorization" variant="warning" clickable onClick={() => drillAgents({ authorized: 'false' })} />
        <StatCard label="Open Violations" value={stats?.open_violations}     sub="Policy breaches"       variant="danger"  clickable onClick={() => drillMitigations({ tab: 'violations', status: 'open' })} />
        <StatCard label="New Detections"  value={stats?.new_detections}      sub="Require review"        variant="warning" clickable onClick={() => drillDetections({ status: 'new' })} />
        <StatCard label="Active Policies" value={stats?.active_policies}     sub="Enforced rules"        variant="success" clickable onClick={() => onNav('policies')} />
        <StatCard label="Pending Actions" value={stats?.pending_mitigations} sub="Mitigations queued"    variant="purple"  clickable onClick={() => drillMitigations({ tab: 'mitigations' })} />
        <StatCard label="Activity (24h)"  value={stats?.activity_last_24h}   sub="Events recorded"                         clickable onClick={() => drillActivities({})} />
      </div>

      <div className="grid-3">
        {/* Activity chart — click a point to drill into that hour */}
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Activity Over Last 24 Hours</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>click bar to filter ↗</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} onClick={handleChartClick} style={{ cursor: 'pointer' }}>
              <defs>
                <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="flaggedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d4a" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748b' }} interval={3} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="total"   stroke="#06b6d4" fill="url(#totalGrad)"   strokeWidth={2} name="Total" />
              <Area type="monotone" dataKey="flagged" stroke="#ef4444" fill="url(#flaggedGrad)" strokeWidth={2} name="Flagged" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Risk pie — click a slice to filter agents */}
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Risk Distribution</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>click slice to filter ↗</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={riskPieData} cx="50%" cy="50%"
                innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value"
                onClick={handlePieClick} style={{ cursor: 'pointer' }}
              >
                {riskPieData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2">
        {/* Recent violations — click row to drill */}
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Recent Policy Violations</span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              onClick={() => drillMitigations({ tab: 'violations' })}
            >View all ↗</button>
          </div>
          {violations.length === 0 ? (
            <div className="empty-state"><div className="icon">✓</div><p>No violations</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Agent</th><th>Policy</th><th>Severity</th><th>Status</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {violations.map(v => (
                    <tr
                      key={v.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => drillMitigations({ tab: 'violations', highlight: v.id })}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                      title="Click to view violation details"
                    >
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{v.agent}</td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.policy}</td>
                      <td><span className={`badge badge-${v.severity}`}>{v.severity}</span></td>
                      <td><span className={`badge badge-${v.status}`}>{v.status}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        {new Date(v.detected_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Latest detections — click card to drill */}
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Latest Detections</span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              onClick={() => drillDetections({})}
            >View all ↗</button>
          </div>
          {detections.length === 0 ? (
            <div className="empty-state"><div className="icon">◎</div><p>No recent detections</p></div>
          ) : (
            <div>
              {detections.map(d => (
                <div
                  key={d.id}
                  className="detection-item"
                  style={{ marginBottom: 8, cursor: 'pointer', borderRadius: 6, padding: '6px 4px', transition: 'background 0.12s' }}
                  onClick={() => drillDetections({ highlight: d.id, status: d.status })}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                  title="Click to view detection details"
                >
                  <div className="detection-header">
                    <span className="detection-type" style={{ color: confidenceColor(d.confidence) }}>
                      {d.detection_type.replace(/_/g, ' ')}
                    </span>
                    <span className={`badge badge-${d.status}`}>{d.status}</span>
                  </div>
                  <div className="detection-source">via {d.source} · {new Date(d.detected_at).toLocaleTimeString()}</div>
                  <div style={{ marginTop: 6 }}>
                    <div className="confidence">
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 70 }}>
                        Confidence {Math.round(d.confidence * 100)}%
                      </span>
                      <div className="confidence-bar">
                        <div
                          className="confidence-fill"
                          style={{ width: `${d.confidence * 100}%`, background: confidenceColor(d.confidence) }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
