import { useState, useEffect } from 'react'
import { api } from '../api/client'

const CONDITION_TYPES = [
  { value: 'unauthorized', label: 'Agent is Unauthorized' },
  { value: 'activity_type', label: 'Activity Type equals' },
  { value: 'action_contains', label: 'Action contains keyword' },
  { value: 'risk_score_above', label: 'Risk score above' },
  { value: 'agent_type', label: 'Agent type equals' },
  { value: 'environment', label: 'Environment equals' },
  { value: 'capability_exceeded', label: 'Capability boundary exceeded' },
]

const ACTIONS = ['allow', 'warn', 'block', 'quarantine', 'terminate', 'escalate']
const ACTION_COLORS = {
  allow: 'var(--success)', warn: 'var(--warning)', block: 'var(--danger)',
  quarantine: '#ef4444', terminate: '#dc2626', escalate: 'var(--accent-purple)',
}

function ConditionRow({ condition, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <select className="form-select" style={{ flex: 2 }} value={condition.type} onChange={e => onChange({ ...condition, type: e.target.value })}>
        {CONDITION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      {!['unauthorized', 'capability_exceeded'].includes(condition.type) && (
        <input
          className="form-input"
          style={{ flex: 1 }}
          placeholder="value"
          value={condition.value ?? ''}
          onChange={e => onChange({ ...condition, value: e.target.value })}
        />
      )}
      <button className="btn btn-danger btn-sm btn-icon" onClick={onRemove}>✕</button>
    </div>
  )
}

function PolicyModal({ policy, onClose, onSave }) {
  const [form, setForm] = useState(policy ? {
    ...policy,
    conditions: policy.conditions || [],
  } : {
    name: '', description: '', enabled: true, priority: 100,
    scope: {}, conditions: [], action: 'warn', action_config: {},
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const addCondition = () => set('conditions', [...form.conditions, { type: 'action_contains', value: '' }])
  const updateCondition = (i, c) => set('conditions', form.conditions.map((x, idx) => idx === i ? c : x))
  const removeCondition = (i) => set('conditions', form.conditions.filter((_, idx) => idx !== i))

  const coerceConditionValues = (conditions) =>
    conditions.map(c => {
      if (c.type === 'unauthorized' || c.type === 'capability_exceeded') return { ...c, value: true }
      if (c.type === 'risk_score_above') return { ...c, value: parseFloat(c.value) || 0 }
      return c
    })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{policy ? 'Edit Policy' : 'Create Policy'}</h3>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Policy Name *</label>
            <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Block Unauthorized Agents" />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-textarea" value={form.description} onChange={e => set('description', e.target.value)} placeholder="What does this policy govern?" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Action</label>
              <select className="form-select" value={form.action} onChange={e => set('action', e.target.value)}>
                {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority (lower = higher)</label>
              <input className="form-input" type="number" value={form.priority} onChange={e => set('priority', parseInt(e.target.value) || 100)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">
              Conditions
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={addCondition}>+ Add</button>
            </label>
            {form.conditions.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>No conditions — add at least one</div>
            )}
            {form.conditions.map((c, i) => (
              <ConditionRow key={i} condition={c} onChange={v => updateCondition(i, v)} onRemove={() => removeCondition(i)} />
            ))}
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />
              <span className="form-label" style={{ margin: 0 }}>Enabled</span>
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ ...form, conditions: coerceConditionValues(form.conditions) }).then(onClose)}
            disabled={!form.name || form.conditions.length === 0}
          >
            {policy ? 'Save Changes' : 'Create Policy'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PolicyManager({ onAlert }) {
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)

  const load = async () => {
    try { setPolicies(await api.getPolicies()) }
    catch (e) { onAlert('error', e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleSave = async (data) => {
    try {
      if (modal?.policy) {
        await api.updatePolicy(modal.policy.id, data)
        onAlert('success', 'Policy updated')
      } else {
        await api.createPolicy(data)
        onAlert('success', 'Policy created')
      }
      await load()
    } catch (e) { onAlert('error', e.message); throw e }
  }

  const handleToggle = async (policy) => {
    try {
      await api.togglePolicy(policy.id)
      await load()
      onAlert('info', `Policy ${policy.enabled ? 'disabled' : 'enabled'}`)
    } catch (e) { onAlert('error', e.message) }
  }

  const handleDelete = async (policy) => {
    if (!confirm(`Delete policy "${policy.name}"?`)) return
    try { await api.deletePolicy(policy.id); await load(); onAlert('success', 'Policy deleted') }
    catch (e) { onAlert('error', e.message) }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Policy Manager</h2>
        <p>Define and enforce governance rules for AI agent behavior</p>
      </div>

      <div className="toolbar">
        <div className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={() => setModal({ policy: null })}>+ Create Policy</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {policies.map(p => (
            <div key={p.id} className="card" style={{ padding: '16px 20px', opacity: p.enabled ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</span>
                    <span className={`badge badge-${p.enabled ? 'enabled' : 'disabled'}`}>{p.enabled ? 'enabled' : 'disabled'}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>priority: {p.priority}</span>
                  </div>
                  {p.description && (
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>{p.description}</div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Action:</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: ACTION_COLORS[p.action] || 'var(--text-primary)' }}>
                        {p.action.toUpperCase()}
                      </span>
                    </div>
                    <div className="condition-list">
                      {(p.conditions || []).map((c, i) => (
                        <span key={i} className="condition-chip">
                          {c.type}{c.value !== undefined && c.value !== true ? `: ${c.value}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className={`btn btn-sm ${p.enabled ? 'btn-warning' : 'btn-success'}`} onClick={() => handleToggle(p)}>
                    {p.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal({ policy: p })}>Edit</button>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(p)} title="Delete">⊖</button>
                </div>
              </div>
            </div>
          ))}
          {policies.length === 0 && (
            <div className="empty-state card"><div className="icon">⊟</div><p>No policies defined yet</p></div>
          )}
        </div>
      )}

      {modal && (
        <PolicyModal
          policy={modal.policy}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
