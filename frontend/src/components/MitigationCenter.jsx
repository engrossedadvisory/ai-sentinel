import { useState, useEffect } from 'react'
import { api } from '../api/client'

const ACTION_LABELS = {
  suspend: { label: 'Suspend', desc: 'Mark agent as inactive — stops activity recording', color: 'var(--warning)' },
  quarantine: { label: 'Quarantine', desc: 'Isolate agent, revoke authorization, raise risk to HIGH', color: 'var(--danger)' },
  terminate: { label: 'Terminate', desc: 'Deauthorize and mark agent as terminated permanently', color: '#dc2626' },
  block_traffic: { label: 'Block Traffic', desc: 'Signal network layer to drop all traffic from this agent', color: 'var(--danger)' },
  rate_limit: { label: 'Rate Limit', desc: 'Apply API rate-limiting to throttle agent requests', color: 'var(--warning)' },
  alert: { label: 'Send Alert', desc: 'Broadcast a governance alert to all connected dashboards', color: 'var(--accent-blue)' },
  escalate: { label: 'Escalate', desc: 'Create an escalation ticket for human governance review', color: 'var(--accent-purple)' },
}

function MitigationModal({ agents, onClose, onSubmit }) {
  const [form, setForm] = useState({
    agent_id: '',
    action_type: 'alert',
    action_config: {},
    initiated_by: 'human',
    config_note: '',
    rate_limit: '10',
    alert_message: '',
    escalate_reason: '',
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const buildConfig = () => {
    if (form.action_type === 'rate_limit') return { requests_per_minute: parseInt(form.rate_limit) || 10, window_seconds: 60 }
    if (form.action_type === 'alert') return { message: form.alert_message || 'Governance alert triggered', severity: 'high' }
    if (form.action_type === 'escalate') return { reason: form.escalate_reason || 'Manual escalation', assigned_to: 'governance-team', priority: 'high' }
    return {}
  }

  const handleSubmit = () => {
    onSubmit({
      agent_id: form.agent_id ? parseInt(form.agent_id) : null,
      action_type: form.action_type,
      action_config: buildConfig(),
      initiated_by: 'human',
    })
    onClose()
  }

  const actionInfo = ACTION_LABELS[form.action_type]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Execute Mitigation</h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Target Agent</label>
            <select className="form-select" value={form.agent_id} onChange={e => set('agent_id', e.target.value)}>
              <option value="">— No specific agent (broadcast) —</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.agent_id})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Action</label>
            <select className="form-select" value={form.action_type} onChange={e => set('action_type', e.target.value)}>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {actionInfo && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, padding: '8px 10px', background: 'var(--bg-primary)', borderRadius: 6, borderLeft: `3px solid ${actionInfo.color}` }}>
                {actionInfo.desc}
              </div>
            )}
          </div>

          {form.action_type === 'rate_limit' && (
            <div className="form-group">
              <label className="form-label">Requests per Minute</label>
              <input className="form-input" type="number" value={form.rate_limit} onChange={e => set('rate_limit', e.target.value)} min={1} />
            </div>
          )}
          {form.action_type === 'alert' && (
            <div className="form-group">
              <label className="form-label">Alert Message</label>
              <input className="form-input" value={form.alert_message} onChange={e => set('alert_message', e.target.value)} placeholder="Governance alert triggered" />
            </div>
          )}
          {form.action_type === 'escalate' && (
            <div className="form-group">
              <label className="form-label">Escalation Reason</label>
              <textarea className="form-textarea" value={form.escalate_reason} onChange={e => set('escalate_reason', e.target.value)} placeholder="Describe the reason for escalation…" />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ background: actionInfo?.color || 'var(--accent-cyan)', color: '#fff' }}
            onClick={handleSubmit}
          >
            Execute: {actionInfo?.label}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MitigationCenter({ wsEvent, onAlert, demoMode, initialFilter = {} }) {
  const [mitigations,   setMitigations]   = useState([])
  const [violations,    setViolations]     = useState([])
  const [agents,        setAgents]         = useState([])
  const [loading,       setLoading]        = useState(true)
  const [modal,         setModal]          = useState(false)
  const [tab,           setTab]            = useState(initialFilter.tab || 'mitigations')
  const [violationFilter, setViolationFilter] = useState(initialFilter.status || '')
  const highlightId = initialFilter.highlight || null

  const load = async () => {
    try {
      const [m, v, a] = await Promise.all([
        api.getMitigations(),
        api.getViolations(),
        api.getAgents(),
      ])
      setMitigations(m)
      setViolations(v)
      setAgents(a)
    } catch (e) { onAlert('error', e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [demoMode])

  useEffect(() => {
    if (wsEvent?.type === 'mitigation_update') load()
  }, [wsEvent])

  const handleSubmit = async (data) => {
    try {
      await api.createMitigation(data)
      await load()
      onAlert('success', 'Mitigation action executed')
    } catch (e) { onAlert('error', e.message) }
  }

  const handleViolationStatus = async (id, status) => {
    try {
      await api.updateViolationStatus(id, status)
      await load()
      onAlert('info', `Violation marked as ${status}`)
    } catch (e) { onAlert('error', e.message) }
  }

  const statusColor = s => ({ completed: 'var(--success)', failed: 'var(--danger)', in_progress: 'var(--accent-blue)', pending: 'var(--text-muted)' }[s] || 'var(--text-muted)')

  return (
    <div className="page">
      <div className="page-header">
        <h2>Mitigation Center</h2>
        <p>Execute governance actions and track policy violation responses</p>
      </div>

      <div className="toolbar">
        <div style={{ display: 'flex', gap: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {['mitigations', 'violations'].map(t => (
            <button
              key={t}
              className="btn"
              style={{ borderRadius: 0, background: tab === t ? 'var(--bg-hover)' : 'transparent', color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)', border: 'none' }}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'violations' && violations.filter(v => v.status === 'open').length > 0 && (
                <span className="nav-badge" style={{ marginLeft: 8 }}>{violations.filter(v => v.status === 'open').length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ Execute Mitigation</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : tab === 'mitigations' ? (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ID</th><th>Action</th><th>Status</th><th>Agent</th><th>Initiated By</th><th>Result</th><th>Time</th></tr>
              </thead>
              <tbody>
                {mitigations.map(m => {
                  const agent = agents.find(a => a.id === m.agent_id)
                  return (
                    <tr key={m.id}>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 12 }}>#{m.id}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: ACTION_LABELS[m.action_type]?.color || 'var(--text-primary)' }}>
                          {ACTION_LABELS[m.action_type]?.label || m.action_type}
                        </span>
                      </td>
                      <td><span className={`badge badge-${m.status}`}>{m.status}</span></td>
                      <td style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>
                        {agent ? agent.name : m.agent_id ? `#${m.agent_id}` : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.initiated_by}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.result || '—'}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {mitigations.length === 0 && (
              <div className="empty-state"><div className="icon">⊗</div><p>No mitigations executed yet</p></div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <select className="form-select" style={{ width: 160 }} value={violationFilter} onChange={e => setViolationFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {['open', 'acknowledged', 'resolved', 'false_positive'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>ID</th><th>Agent</th><th>Policy</th><th>Severity</th><th>Status</th><th>Detected</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {violations
                    .filter(v => !violationFilter || v.status === violationFilter)
                    .map(v => {
                      const agent      = agents.find(a => a.id === v.agent_id)
                      const isHighlight = highlightId && v.id === highlightId
                      return (
                        <tr key={v.id} style={{ background: isHighlight ? 'rgba(6,182,212,0.08)' : '', outline: isHighlight ? '1px solid rgba(6,182,212,0.3)' : '' }}>
                          <td style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 12 }}>#{v.id}</td>
                          <td style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>
                            {agent?.name || '—'}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {v.violation_details?.policy_name || `Policy #${v.policy_id}`}
                          </td>
                          <td><span className={`badge badge-${v.severity}`}>{v.severity}</span></td>
                          <td><span className={`badge badge-${v.status}`}>{v.status}</span></td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {new Date(v.detected_at).toLocaleString()}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {v.status === 'open' && (
                                <button className="btn btn-warning btn-sm" onClick={() => handleViolationStatus(v.id, 'acknowledged')}>Ack</button>
                              )}
                              {v.status !== 'resolved' && (
                                <button className="btn btn-success btn-sm" onClick={() => handleViolationStatus(v.id, 'resolved')}>Resolve</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
              {violations.filter(v => !violationFilter || v.status === violationFilter).length === 0 && (
                <div className="empty-state"><div className="icon">✓</div><p>No policy violations</p></div>
              )}
            </div>
          </div>
        </>
      )}

      {modal && (
        <MitigationModal agents={agents} onClose={() => setModal(false)} onSubmit={handleSubmit} />
      )}
    </div>
  )
}
