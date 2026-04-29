import { useState, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { api } from '../api/client'

const RISK_COLORS = { low: '#10b981', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' }

function StatCard({ label, value, sub, variant = 'default' }) {
  return (
    <div className={`stat-card ${variant}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export default function Dashboard({ wsEvent }) {
  const [stats, setStats] = useState(null)
  const [chart, setChart] = useState([])
  const [violations, setViolations] = useState([])
  const [detections, setDetections] = useState([])

  const load = async () => {
    try {
      const [s, c, v, d] = await Promise.all([
        api.getStats(),
        api.getActivityChart(24),
        api.getRecentViolations(8),
        api.getRecentDetections(5),
      ])
      setStats(s)
      setChart(c)
      setViolations(v)
      setDetections(d)
    } catch (e) {
      console.error('Dashboard load error:', e)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (wsEvent && ['new_activity', 'policy_violation', 'new_detection', 'agent_status_change'].includes(wsEvent.type)) {
      load()
    }
  }, [wsEvent])

  const riskPieData = stats
    ? Object.entries(stats.risk_distribution).map(([k, v]) => ({ name: k, value: v }))
    : []

  const severityColor = s =>
    ({ low: '#10b981', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' }[s] || '#64748b')

  const confidenceColor = c => c > 0.85 ? '#ef4444' : c > 0.65 ? '#f59e0b' : '#3b82f6'

  return (
    <div className="page">
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Real-time overview of AI agent health, policy compliance, and threat posture</p>
      </div>

      <div className="stats-grid">
        <StatCard label="Total Agents" value={stats?.total_agents} sub={`${stats?.active_agents} active`} />
        <StatCard label="Quarantined" value={stats?.quarantined_agents} sub="Isolated agents" variant="danger" />
        <StatCard label="Unauthorized" value={stats?.unauthorized_agents} sub="Require authorization" variant="warning" />
        <StatCard label="Open Violations" value={stats?.open_violations} sub="Policy breaches" variant="danger" />
        <StatCard label="New Detections" value={stats?.new_detections} sub="Require review" variant="warning" />
        <StatCard label="Active Policies" value={stats?.active_policies} sub="Enforced rules" variant="success" />
        <StatCard label="Pending Actions" value={stats?.pending_mitigations} sub="Mitigations queued" variant="purple" />
        <StatCard label="Activity (24h)" value={stats?.activity_last_24h} sub="Events recorded" />
      </div>

      <div className="grid-3">
        <div className="card">
          <div className="card-title">Activity Over Last 24 Hours</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="flaggedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d4a" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748b' }} interval={3} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
              <Tooltip
                contentStyle={{ background: '#141d35', border: '1px solid #1e2d4a', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Area type="monotone" dataKey="total" stroke="#06b6d4" fill="url(#totalGrad)" strokeWidth={2} name="Total" />
              <Area type="monotone" dataKey="flagged" stroke="#ef4444" fill="url(#flaggedGrad)" strokeWidth={2} name="Flagged" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Risk Distribution</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={riskPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                {riskPieData.map((entry) => (
                  <Cell key={entry.name} fill={RISK_COLORS[entry.name] || '#64748b'} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#141d35', border: '1px solid #1e2d4a', borderRadius: 8 }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 12 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Recent Policy Violations</div>
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
                    <tr key={v.id}>
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

        <div className="card">
          <div className="card-title">Latest Detections</div>
          {detections.length === 0 ? (
            <div className="empty-state"><div className="icon">◎</div><p>No recent detections</p></div>
          ) : (
            <div>
              {detections.map(d => (
                <div key={d.id} className="detection-item" style={{ marginBottom: 8 }}>
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
