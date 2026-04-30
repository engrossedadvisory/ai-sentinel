import { useState, useEffect } from 'react'
import { api } from '../api/client'

function Badge({ value, type }) {
  return <span className={`badge badge-${value}`}>{value}</span>
}

function AgentModal({ agent, onClose, onSave }) {
  const [form, setForm] = useState(agent || {
    name: '', type: 'llm_assistant', version: '1.0.0', endpoint: '',
    owner: '', environment: 'prod', deployment_source: 'docker',
    capabilities: '', allowed_actions: '', is_authorized: false,
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async () => {
    const data = {
      ...form,
      capabilities: typeof form.capabilities === 'string'
        ? form.capabilities.split(',').map(s => s.trim()).filter(Boolean)
        : form.capabilities,
      allowed_actions: typeof form.allowed_actions === 'string'
        ? form.allowed_actions.split(',').map(s => s.trim()).filter(Boolean)
        : form.allowed_actions,
    }
    await onSave(data)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{agent ? 'Edit Agent' : 'Register New Agent'}</h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Agent Name *</label>
            <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Mythos Core" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-select" value={form.type} onChange={e => set('type', e.target.value)}>
                {['llm_assistant', 'autonomous_agent', 'workflow_orchestrator', 'tool_agent', 'unknown'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Environment</label>
              <select className="form-select" value={form.environment} onChange={e => set('environment', e.target.value)}>
                {['prod', 'staging', 'dev', 'unknown'].map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Version</label>
              <input className="form-input" value={form.version} onChange={e => set('version', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Owner</label>
              <input className="form-input" value={form.owner} onChange={e => set('owner', e.target.value)} placeholder="team-name" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Endpoint URL</label>
            <input className="form-input" value={form.endpoint} onChange={e => set('endpoint', e.target.value)} placeholder="http://agent-host:8080" />
          </div>
          <div className="form-group">
            <label className="form-label">Capabilities (comma-separated)</label>
            <input className="form-input" value={Array.isArray(form.capabilities) ? form.capabilities.join(', ') : form.capabilities} onChange={e => set('capabilities', e.target.value)} placeholder="search, read, summarize" />
          </div>
          <div className="form-group">
            <label className="form-label">Allowed Actions (comma-separated)</label>
            <input className="form-input" value={Array.isArray(form.allowed_actions) ? form.allowed_actions.join(', ') : form.allowed_actions} onChange={e => set('allowed_actions', e.target.value)} placeholder="read, query, respond" />
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_authorized} onChange={e => set('is_authorized', e.target.checked)} />
              <span className="form-label" style={{ margin: 0 }}>Authorized</span>
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!form.name}>
            {agent ? 'Save Changes' : 'Register Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AgentRegistry({ wsEvent, onAlert, demoMode, initialFilter = {} }) {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [filter, setFilter] = useState({
    status: initialFilter.status || '',
    environment: initialFilter.environment || '',
    authorized: initialFilter.authorized || '',
    risk_level: initialFilter.risk_level || '',
  })

  const load = async () => {
    try {
      const params = {}
      if (filter.status) params.status = filter.status
      if (filter.environment) params.environment = filter.environment
      if (filter.authorized !== '') params.authorized = filter.authorized === 'true'
      if (filter.risk_level) params.risk_level = filter.risk_level
      const data = await api.getAgents(params)
      setAgents(data)
    } catch (e) { onAlert('error', e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filter, demoMode])

  useEffect(() => {
    if (wsEvent?.type === 'agent_registered' || wsEvent?.type === 'agent_status_change' || wsEvent?.type === 'agent_updated') {
      load()
    }
  }, [wsEvent])

  const action = async (fn, successMsg) => {
    try { await fn(); await load(); onAlert('success', successMsg) }
    catch (e) { onAlert('error', e.message) }
  }

  const handleSave = async (data) => {
    if (modal?.agent) {
      await action(() => api.updateAgent(modal.agent.agent_id, data), 'Agent updated')
    } else {
      await action(() => api.createAgent(data), 'Agent registered')
    }
  }

  const riskColor = r => ({ low: '#10b981', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' }[r] || '#94a3b8')

  return (
    <div className="page">
      <div className="page-header">
        <h2>Agent Registry</h2>
        <p>Inventory and lifecycle management for all AI agents in your environment</p>
      </div>

      <div className="toolbar">
        <select className="form-select" style={{ width: 140 }} value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))}>
          <option value="">All Statuses</option>
          {['active', 'inactive', 'suspended', 'quarantined', 'unknown'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="form-select" style={{ width: 140 }} value={filter.environment} onChange={e => setFilter(p => ({ ...p, environment: e.target.value }))}>
          <option value="">All Environments</option>
          {['prod', 'staging', 'dev', 'unknown'].map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select className="form-select" style={{ width: 160 }} value={filter.authorized} onChange={e => setFilter(p => ({ ...p, authorized: e.target.value }))}>
          <option value="">Auth: All</option>
          <option value="true">Authorized</option>
          <option value="false">Unauthorized</option>
        </select>
        <select className="form-select" style={{ width: 140 }} value={filter.risk_level} onChange={e => setFilter(p => ({ ...p, risk_level: e.target.value }))}>
          <option value="">All Risk Levels</option>
          {['low', 'medium', 'high', 'critical'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={() => setModal({ agent: null })}>+ Register Agent</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th><th>Type</th><th>Status</th><th>Risk</th>
                  <th>Auth</th><th>Environment</th><th>Last Seen</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(a => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{a.agent_id}</div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{a.type}</td>
                    <td><Badge value={a.status} /></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: riskColor(a.risk_level), flexShrink: 0 }} />
                        <span className={`badge badge-${a.risk_level}`}>{a.risk_level}</span>
                      </div>
                    </td>
                    <td><Badge value={a.is_authorized ? 'authorized' : 'unauthorized'} /></td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{a.environment}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(a.last_seen).toLocaleString()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {!a.is_authorized && (
                          <button className="btn btn-success btn-sm" onClick={() => action(() => api.authorizeAgent(a.agent_id), `${a.name} authorized`)}>
                            Authorize
                          </button>
                        )}
                        {a.status !== 'quarantined' && (
                          <button className="btn btn-danger btn-sm" onClick={() => action(() => api.quarantineAgent(a.agent_id), `${a.name} quarantined`)}>
                            Quarantine
                          </button>
                        )}
                        {a.status === 'active' && (
                          <button className="btn btn-warning btn-sm" onClick={() => action(() => api.suspendAgent(a.agent_id), `${a.name} suspended`)}>
                            Suspend
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setModal({ agent: a })} title="Edit">✎</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {agents.length === 0 && (
              <div className="empty-state"><div className="icon">⬡</div><p>No agents found</p></div>
            )}
          </div>
        </div>
      )}

      {modal && (
        <AgentModal
          agent={modal.agent}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
