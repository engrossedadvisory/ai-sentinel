import { useState, useEffect } from 'react'
import { api } from '../api/client'

const PROVIDER_COLORS = {
  claude: '#06b6d4',
  ollama: '#10b981',
  openai: '#8b5cf6',
  none:   '#64748b',
}

const PROVIDER_LABELS = {
  claude: 'Claude (Anthropic)',
  ollama: 'Ollama (Local)',
  openai: 'OpenAI',
  none:   'Inactive',
}

const BRAIN_META = {
  triage:     { icon: '◇', color: '#06b6d4', tagline: 'Routes events to specialist brains' },
  detection:  { icon: '◉', color: '#ef4444', tagline: 'Threat-hunts new deployments & anomalies' },
  risk:       { icon: '△', color: '#f59e0b', tagline: 'Context-aware activity risk scoring' },
  policy:     { icon: '▣', color: '#8b5cf6', tagline: 'Identifies governance gaps, drafts rules' },
  mitigation: { icon: '⊛', color: '#10b981', tagline: 'Decides proportional incident response' },
}

const ROLES = ['triage', 'detection', 'risk', 'policy', 'mitigation']

function ConfigModal({ brain, onClose, onSave }) {
  const [provider, setProvider] = useState(brain.provider)
  const [model, setModel]       = useState(brain.model)
  const [testing, setTesting]   = useState(false)
  const [testResult, setTestResult] = useState(null)

  const defaultModels = { claude: 'claude-sonnet-4-6', ollama: 'llama3.2', openai: 'gpt-4o', none: '' }

  const handleProviderChange = (p) => {
    setProvider(p)
    setModel(defaultModels[p] || '')
    setTestResult(null)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // Save first, then test
      await api.configureBrain(brain.role, { provider, model })
      const r = await api.testBrain(brain.role)
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, reason: e.message })
    } finally { setTesting(false) }
  }

  const PRESET_MODELS = {
    claude: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'],
    ollama: ['llama3.2', 'llama3.1', 'mistral', 'phi3', 'gemma2', 'deepseek-r1'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    none:   [],
  }

  const meta = BRAIN_META[brain.role]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22, color: meta.color }}>{meta.icon}</span>
            <div>
              <h3>{brain.label} Brain</h3>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{meta.tagline}</p>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">

          <div className="form-group">
            <label className="form-label">Provider</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {Object.entries(PROVIDER_LABELS).map(([p, label]) => (
                <div
                  key={p}
                  onClick={() => handleProviderChange(p)}
                  style={{
                    padding: '10px 8px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                    border: `2px solid ${provider === p ? PROVIDER_COLORS[p] : 'var(--border)'}`,
                    background: provider === p ? `${PROVIDER_COLORS[p]}15` : 'var(--bg-primary)',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 2 }}>
                    {p === 'claude' ? '◈' : p === 'ollama' ? '⊕' : p === 'openai' ? '⊞' : '⊗'}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: provider === p ? PROVIDER_COLORS[p] : 'var(--text-muted)' }}>
                    {p.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {provider !== 'none' && (
            <div className="form-group">
              <label className="form-label">Model</label>
              <input
                className="form-input"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder={defaultModels[provider]}
                list={`models-${brain.role}`}
              />
              <datalist id={`models-${brain.role}`}>
                {(PRESET_MODELS[provider] || []).map(m => <option key={m} value={m} />)}
              </datalist>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {(PRESET_MODELS[provider] || []).map(m => (
                  <span
                    key={m}
                    className="condition-chip"
                    style={{ cursor: 'pointer', fontSize: 10 }}
                    onClick={() => setModel(m)}
                  >{m}</span>
                ))}
              </div>
            </div>
          )}

          {provider === 'claude' && (
            <div style={{ padding: '8px 12px', background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              Requires <code style={{ color: 'var(--accent-cyan)' }}>ANTHROPIC_API_KEY</code> env var.
              <br />Recommended: <strong>Haiku</strong> for Triage (speed), <strong>Sonnet</strong> for Detection/Risk/Policy, <strong>Opus</strong> for Mitigation (critical decisions).
            </div>
          )}
          {provider === 'ollama' && (
            <div style={{ padding: '8px 12px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              Runs locally — no API key needed. Set <code style={{ color: 'var(--success)' }}>OLLAMA_HOST</code> if not on localhost.
              <br />Run: <code style={{ color: 'var(--success)' }}>ollama pull {model || 'llama3.2'}</code>
            </div>
          )}

          {testResult && (
            <div style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 6,
              background: testResult.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${testResult.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              fontSize: 12, color: testResult.ok ? 'var(--success)' : 'var(--danger)',
            }}>
              {testResult.ok
                ? `◉ Brain online — ${testResult.model}`
                : `◬ Test failed: ${testResult.reason}`}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost btn-sm" onClick={handleTest} disabled={testing || provider === 'none'}>
            {testing ? '…Testing' : '◎ Test Brain'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => { onSave(brain.role, provider, model); onClose() }}
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  )
}

function BrainCard({ brain, onConfigure }) {
  const meta    = BRAIN_META[brain.role] || {}
  const color   = PROVIDER_COLORS[brain.provider] || PROVIDER_COLORS.none
  const active  = brain.enabled && brain.configured
  const stats   = brain.stats || {}

  return (
    <div className="card" style={{
      borderTop: `3px solid ${active ? meta.color : 'var(--border)'}`,
      opacity: active ? 1 : 0.75,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
          background: active ? `${meta.color}18` : 'var(--bg-secondary)',
          border: `1px solid ${active ? meta.color + '40' : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, color: active ? meta.color : 'var(--text-muted)',
        }}>
          {meta.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{brain.label}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
              background: active ? `${color}20` : 'rgba(100,116,139,0.12)',
              color: active ? color : 'var(--text-muted)',
              border: `1px solid ${active ? color + '40' : 'transparent'}`,
            }}>
              {active ? brain.provider.toUpperCase() : brain.enabled ? 'NO KEY' : 'INACTIVE'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            {meta.tagline}
          </div>

          {/* Model tag */}
          {brain.enabled && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: active ? color : 'var(--text-muted)',
              padding: '3px 8px', background: 'var(--bg-primary)', borderRadius: 5,
              border: '1px solid var(--border)', display: 'inline-block', marginBottom: 10 }}>
              {brain.model}
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
            <span>Calls: <strong style={{ color: 'var(--text-secondary)' }}>{stats.total_calls || 0}</strong></span>
            <span>Success: <strong style={{ color: 'var(--success)' }}>{stats.success_calls || 0}</strong></span>
            {stats.failed_calls > 0 && <span>Failed: <strong style={{ color: 'var(--danger)' }}>{stats.failed_calls}</strong></span>}
            {stats.avg_latency_ms > 0 && <span>Avg: <strong style={{ color: 'var(--text-secondary)' }}>{stats.avg_latency_ms}ms</strong></span>}
            {stats.last_used && (
              <span>Last: <strong style={{ color: 'var(--text-secondary)' }}>
                {new Date(stats.last_used).toLocaleTimeString()}
              </strong></span>
            )}
          </div>

          {stats.last_error && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)', fontFamily: 'var(--mono)' }}>
              ◬ {stats.last_error.slice(0, 80)}
            </div>
          )}
        </div>

        <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => onConfigure(brain)}>
          Configure
        </button>
      </div>
    </div>
  )
}

function RecommendationCard({ rec, onAccept, onReject }) {
  const actionColor = { warn: 'var(--warning)', block: 'var(--danger)', quarantine: 'var(--danger)', escalate: 'var(--accent-purple)', allow: 'var(--success)' }
  return (
    <div className="card" style={{ borderLeft: '3px solid var(--accent-purple)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 700 }}>{rec.name}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: actionColor[rec.action] || 'var(--text-primary)' }}>
              {rec.action?.toUpperCase()}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              priority {rec.priority} · {rec.brain_model}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{rec.description}</div>
          {rec.rationale && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 8 }}>
              "{rec.rationale}"
            </div>
          )}
          {rec.conditions?.length > 0 && (
            <div className="condition-list">
              {rec.conditions.map((c, i) => (
                <span key={i} className="condition-chip">
                  {c.type}{c.value !== undefined && c.value !== true ? `: ${c.value}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        {rec.status === 'pending' && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button className="btn btn-success btn-sm" onClick={() => onAccept(rec.id)}>Accept</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onReject(rec.id)}>Reject</button>
          </div>
        )}
        {rec.status !== 'pending' && (
          <span className={`badge badge-${rec.status === 'accepted' ? 'active' : 'inactive'}`}>{rec.status}</span>
        )}
      </div>
    </div>
  )
}

export default function BrainCenter({ onAlert }) {
  const [brains, setBrains]           = useState([])
  const [recs, setRecs]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [configModal, setConfigModal] = useState(null)
  const [tab, setTab]                 = useState('brains')
  const [runningPolicy, setRunningPolicy] = useState(false)

  const loadBrains = async () => {
    try {
      const b = await api.getBrains()
      setBrains(ROLES.map(role => b.find(x => x.role === role)).filter(Boolean))
    } catch (e) {
      console.error('loadBrains failed:', e)
      onAlert('error', 'Could not load brains: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadRecs = async () => {
    try {
      const r = await api.getRecommendations()
      setRecs(Array.isArray(r) ? r : [])
    } catch (e) {
      console.error('loadRecs failed:', e)
    }
  }

  const load = async () => {
    await loadBrains()
    loadRecs()  // non-blocking — recommendations are optional
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (role, provider, model) => {
    try {
      await api.configureBrain(role, { provider, model })
      await load()
      onAlert('success', `${role} brain reconfigured → ${provider}/${model || 'default'}`)
    } catch (e) { onAlert('error', e.message) }
  }

  const handleRunPolicy = async () => {
    setRunningPolicy(true)
    try {
      await api.runPolicyBrain()
      onAlert('info', 'Policy Brain triggered — recommendations will appear shortly')
      setTimeout(load, 4000)
    } catch (e) { onAlert('error', e.message) }
    finally { setRunningPolicy(false) }
  }

  const handleAccept = async (id) => {
    try { await api.acceptRecommendation(id); await load(); onAlert('success', 'Policy promoted from recommendation') }
    catch (e) { onAlert('error', e.message) }
  }
  const handleReject = async (id) => {
    try { await api.rejectRecommendation(id); await load() }
    catch (e) { onAlert('error', e.message) }
  }

  const activeBrains = brains.filter(b => b.enabled && b.configured).length
  const pendingRecs  = recs.filter(r => r.status === 'pending').length

  return (
    <div className="page">
      <div className="page-header">
        <h2>Brain Command Center</h2>
        <p>Five specialized AI agents — each independently configured per task, provider, and model</p>
      </div>

      {/* Brain architecture diagram */}
      <div className="card" style={{ marginBottom: 24, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto' }}>
          {ROLES.map((role, i) => {
            const b    = brains.find(x => x.role === role)
            const meta = BRAIN_META[role]
            const on   = b?.enabled && b?.configured
            return (
              <div key={role} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: '10px 16px', borderRadius: 10, minWidth: 90,
                  background: on ? `${meta.color}12` : 'var(--bg-secondary)',
                  border: `1px solid ${on ? meta.color + '40' : 'var(--border)'}`,
                  cursor: 'pointer',
                }}
                  onClick={() => b && setConfigModal(b)}
                >
                  <span style={{ fontSize: 20, color: on ? meta.color : 'var(--text-muted)' }}>{meta.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: on ? meta.color : 'var(--text-muted)' }}>
                    {b?.label || role}
                  </span>
                  {b?.enabled && (
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                      {(b?.model || '').split('-').slice(0, 2).join('-')}
                    </span>
                  )}
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', marginTop: 2,
                    background: on ? meta.color : 'var(--text-muted)',
                    boxShadow: on ? `0 0 6px ${meta.color}` : 'none',
                  }} />
                </div>
                {i < ROLES.length - 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 4px' }}>
                    <div style={{ width: 24, height: 1, background: 'var(--border)' }} />
                    <span style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>
                      {['routes', 'scores', 'advises', 'responds'][i]}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ marginLeft: 'auto', paddingLeft: 16, flexShrink: 0 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: activeBrains > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
              {activeBrains}/{brains.length}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>brains active</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="toolbar">
        <div style={{ display: 'flex', gap: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {[['brains', '◈ Brains'], ['recommendations', `▣ Recommendations${pendingRecs > 0 ? ` (${pendingRecs})` : ''}`]].map(([id, label]) => (
            <button key={id} className="btn" style={{
              borderRadius: 0, border: 'none',
              background: tab === id ? 'var(--bg-hover)' : 'transparent',
              color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
            }} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        {tab === 'recommendations' && (
          <button className="btn btn-primary" onClick={handleRunPolicy} disabled={runningPolicy}>
            {runningPolicy ? '▣ Running Policy Brain…' : '▣ Run Policy Brain'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : tab === 'brains' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {brains.map(b => (
            <BrainCard key={b.role} brain={b} onConfigure={setConfigModal} />
          ))}
          <div className="card" style={{ padding: '12px 16px', borderStyle: 'dashed' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--text-secondary)' }}>How the chain works:</strong><br />
              When a detection arrives → <span style={{ color: BRAIN_META.triage.color }}>◇ Triage</span> classifies it →
              <span style={{ color: BRAIN_META.detection.color }}> ◉ Detection</span> deep-analyzes it →
              if high risk, <span style={{ color: BRAIN_META.mitigation.color }}>⊛ Mitigation</span> recommends a response.<br />
              Each incoming activity → <span style={{ color: BRAIN_META.risk.color }}>△ Risk</span> scores it →
              if a policy fires, <span style={{ color: BRAIN_META.mitigation.color }}>⊛ Mitigation</span> decides the proportional action.<br />
              Every 30 minutes → <span style={{ color: BRAIN_META.policy.color }}>▣ Policy</span> scans recent violations and drafts new governance rules.
            </div>
          </div>
        </div>
      ) : (
        <div>
          {recs.length === 0 ? (
            <div className="empty-state card">
              <div className="icon">▣</div>
              <p>No recommendations yet — click "Run Policy Brain" to generate governance suggestions from recent violations.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recs.map(r => (
                <RecommendationCard key={r.id} rec={r} onAccept={handleAccept} onReject={handleReject} />
              ))}
            </div>
          )}
        </div>
      )}

      {configModal && (
        <ConfigModal
          brain={configModal}
          onClose={() => setConfigModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
