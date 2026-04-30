import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'

// ── Provider metadata ──────────────────────────────────────────────────────
const PROVIDERS = {
  claude: {
    color:       '#06b6d4',
    label:       'Claude',
    sublabel:    'Anthropic',
    icon:        '◈',
    keyLabel:    'API Key',
    keyHint:     'sk-ant-api03-…',
    keyField:    'api_key',
    providerKey: 'anthropic',
    models:      ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
                  'claude-3-opus-20240229', 'claude-3-sonnet-20240229',
                  'claude-3-haiku-20240307'],
    tip:         'Recommended: Haiku for Triage (speed), Sonnet for Detection/Risk/Policy, Opus for Mitigation (critical decisions).',
  },
  openai: {
    color:       '#8b5cf6',
    label:       'OpenAI',
    sublabel:    'ChatGPT / GPT-4',
    icon:        '⊞',
    keyLabel:    'API Key',
    keyHint:     'sk-proj-…',
    keyField:    'api_key',
    providerKey: 'openai',
    models:      ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
    tip:         'gpt-4o is best for analysis tasks. gpt-4o-mini for cost-sensitive brains.',
  },
  gemini: {
    color:       '#4285f4',
    label:       'Gemini',
    sublabel:    'Google AI',
    icon:        '◬',
    keyLabel:    'API Key',
    keyHint:     'AIza…',
    keyField:    'api_key',
    providerKey: 'gemini',
    models:      ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro',
                  'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    tip:         'gemini-2.0-flash is fast and cost-effective. gemini-1.5-pro for complex reasoning.',
  },
  ollama: {
    color:       '#10b981',
    label:       'Ollama',
    sublabel:    'Local / On-premise',
    icon:        '⊕',
    keyLabel:    'Base URL',
    keyHint:     'http://localhost:11434',
    keyField:    'base_url',
    providerKey: 'ollama',
    models:      ['llama3.2', 'llama3.1', 'llama3', 'mistral', 'phi3',
                  'gemma2', 'deepseek-r1', 'codellama', 'qwen2.5', 'mixtral'],
    tip:         'No API key required — runs entirely on your hardware. Pull a model first: ollama pull llama3.2',
  },
  none: {
    color:       '#64748b',
    label:       'None',
    sublabel:    'Disabled',
    icon:        '⊗',
    keyLabel:    null,
    keyField:    null,
    providerKey: null,
    models:      [],
    tip:         'This brain will be skipped in all analysis chains.',
  },
}

const BRAIN_META = {
  triage:     { icon: '◇', color: '#06b6d4', tagline: 'Routes events to specialist brains' },
  detection:  { icon: '◉', color: '#ef4444', tagline: 'Threat-hunts new deployments & anomalies' },
  risk:       { icon: '△', color: '#f59e0b', tagline: 'Context-aware activity risk scoring' },
  policy:     { icon: '▣', color: '#8b5cf6', tagline: 'Identifies governance gaps, drafts rules' },
  mitigation: { icon: '⊛', color: '#10b981', tagline: 'Decides proportional incident response' },
}

const ROLES = ['triage', 'detection', 'risk', 'policy', 'mitigation']


// ── Key visibility toggle hook ─────────────────────────────────────────────
function KeyInput({ value, onChange, placeholder, disabled }) {
  const [visible, setVisible] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-input"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ paddingRight: 40, fontFamily: visible ? 'inherit' : 'var(--mono)', letterSpacing: visible ? 'normal' : '0.05em' }}
        autoComplete="off"
        spellCheck="false"
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 14, padding: '2px 4px',
          lineHeight: 1,
        }}
        title={visible ? 'Hide key' : 'Show key'}
      >
        {visible ? '◑' : '◐'}
      </button>
    </div>
  )
}


// ── Ollama Model Manager ──────────────────────────────────────────────────
const POPULAR_MODELS = [
  { name: 'llama3.2',      size: '2B',   tag: 'fast'      },
  { name: 'llama3.2:1b',   size: '1B',   tag: 'tiny'      },
  { name: 'llama3.1',      size: '8B',   tag: 'balanced'  },
  { name: 'mistral',       size: '7B',   tag: 'popular'   },
  { name: 'phi3',          size: '3.8B', tag: 'fast'      },
  { name: 'gemma2',        size: '9B',   tag: 'google'    },
  { name: 'deepseek-r1',   size: '7B',   tag: 'reasoning' },
  { name: 'qwen2.5',       size: '7B',   tag: 'balanced'  },
  { name: 'codellama',     size: '7B',   tag: 'code'      },
  { name: 'mixtral',       size: '47B',  tag: 'powerful'  },
]

const TAG_COLORS = {
  fast:      '#06b6d4',
  tiny:      '#8b5cf6',
  balanced:  '#10b981',
  popular:   '#f59e0b',
  google:    '#4285f4',
  reasoning: '#ef4444',
  code:      '#f97316',
  powerful:  '#ec4899',
}

function OllamaModelManager({ onSelectModel, compact = false }) {
  const [installed,   setInstalled]   = useState([])
  const [pullInput,   setPullInput]   = useState('')
  const [pulling,     setPulling]     = useState({})   // { model: {status,progress,pct} }
  const [loadError,   setLoadError]   = useState(null)
  const pollRef = useRef({})

  const loadInstalled = useCallback(async () => {
    try {
      const models = await api.getOllamaModels()
      setInstalled(Array.isArray(models) ? models : [])
      setLoadError(null)
    } catch {
      setLoadError('Ollama not reachable — is it running?')
    }
  }, [])

  useEffect(() => {
    loadInstalled()
    return () => { Object.values(pollRef.current).forEach(clearInterval) }
  }, [loadInstalled])

  const startPoll = (model) => {
    if (pollRef.current[model]) return
    pollRef.current[model] = setInterval(async () => {
      try {
        const s = await api.getOllamaPullStatus(model)
        setPulling(p => ({ ...p, [model]: s }))
        if (s.status === 'done' || s.status === 'error') {
          clearInterval(pollRef.current[model])
          delete pollRef.current[model]
          if (s.status === 'done') loadInstalled()
        }
      } catch {
        clearInterval(pollRef.current[model])
        delete pollRef.current[model]
      }
    }, 1200)
  }

  const handlePull = async (model) => {
    const m = model.trim()
    if (!m) return
    setPulling(p => ({ ...p, [m]: { status: 'pulling', progress: 'Starting…', pct: 0 } }))
    try {
      await api.pullOllamaModel(m)
      startPoll(m)
    } catch (e) {
      setPulling(p => ({ ...p, [m]: { status: 'error', progress: e.message, pct: 0 } }))
    }
    setPullInput('')
  }

  const activePulls = Object.entries(pulling).filter(([, s]) => s.status === 'pulling')

  return (
    <div style={{ marginTop: compact ? 12 : 0 }}>
      {/* Installed models */}
      {loadError ? (
        <div style={{ fontSize: 12, color: 'var(--warning)', padding: '6px 0' }}>◬ {loadError}</div>
      ) : installed.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Installed Models
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {installed.map(m => (
              <div
                key={m.name}
                onClick={() => onSelectModel?.(m.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 6, cursor: onSelectModel ? 'pointer' : 'default',
                  background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
                  fontSize: 12, color: '#10b981',
                }}
                title={`${m.size_gb} GB — click to use`}
              >
                <span style={{ fontFamily: 'var(--mono)' }}>{m.name}</span>
                <span style={{ fontSize: 10, opacity: 0.7 }}>{m.size_gb}GB</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          No models installed yet — pull one below.
        </div>
      )}

      {/* Active pulls */}
      {activePulls.map(([model, s]) => (
        <div key={model} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: '#10b981', fontFamily: 'var(--mono)' }}>{model}</span>
            <span style={{ color: 'var(--text-muted)' }}>{s.pct > 0 ? `${s.pct}%` : ''} {s.progress}</span>
          </div>
          <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2, background: '#10b981',
              width: `${s.pct || 5}%`, transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      ))}

      {/* Completed / error */}
      {Object.entries(pulling).filter(([, s]) => s.status !== 'pulling').map(([model, s]) => (
        <div key={model} style={{
          fontSize: 11, padding: '4px 10px', borderRadius: 6, marginBottom: 6,
          color: s.status === 'done' ? '#10b981' : 'var(--danger)',
          background: s.status === 'done' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
        }}>
          {s.status === 'done' ? `◉ ${model} ready` : `◬ ${model}: ${s.progress}`}
        </div>
      ))}

      {/* Pull input */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          className="form-input"
          value={pullInput}
          onChange={e => setPullInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handlePull(pullInput)}
          placeholder="model name  e.g. llama3.2, mistral…"
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={() => handlePull(pullInput)}
          disabled={!pullInput.trim()}
          style={{ flexShrink: 0 }}
        >
          ⊕ Pull
        </button>
      </div>

      {/* Popular model chips */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Popular Models
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {POPULAR_MODELS.map(m => {
          const isInstalled = installed.some(i => i.name === m.name || i.name === m.name + ':latest')
          const isPulling   = pulling[m.name]?.status === 'pulling'
          return (
            <div
              key={m.name}
              onClick={() => !isPulling && handlePull(m.name)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 6, cursor: isPulling ? 'default' : 'pointer',
                border: `1px solid ${isInstalled ? 'rgba(16,185,129,0.3)' : 'var(--border)'}`,
                background: isInstalled ? 'rgba(16,185,129,0.06)' : 'var(--bg-primary)',
                fontSize: 11, color: isInstalled ? '#10b981' : 'var(--text-secondary)',
                opacity: isPulling ? 0.5 : 1,
                transition: 'all 0.15s',
              }}
              title={isInstalled ? 'Already installed' : `Pull ${m.name} (${m.size})`}
            >
              <span style={{ fontFamily: 'var(--mono)' }}>{m.name}</span>
              <span style={{ fontSize: 9, opacity: 0.7 }}>{m.size}</span>
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                background: `${TAG_COLORS[m.tag] || '#64748b'}20`,
                color: TAG_COLORS[m.tag] || '#64748b',
              }}>{m.tag}</span>
              {isInstalled && <span style={{ fontSize: 10 }}>◉</span>}
              {isPulling   && <span style={{ fontSize: 10, color: '#10b981' }}>…</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ── Provider Keys Tab ─────────────────────────────────────────────────────
function ProviderKeysPanel({ onAlert }) {
  const [keys,    setKeys]    = useState({})
  const [inputs,  setInputs]  = useState({})
  const [saving,  setSaving]  = useState({})

  const load = useCallback(async () => {
    try {
      const status = await api.getProviderKeys()
      setKeys(status)
    } catch (e) {
      console.error('Failed to load provider keys:', e)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (providerKey, fieldType) => {
    const val = inputs[providerKey] || ''
    if (!val.trim()) { onAlert('error', 'Enter a value before saving'); return }
    setSaving(s => ({ ...s, [providerKey]: true }))
    try {
      const body = fieldType === 'base_url'
        ? { provider: providerKey, base_url: val }
        : { provider: providerKey, api_key: val }
      await api.setProviderKey(body.provider, body.api_key, body.base_url)
      setInputs(i => ({ ...i, [providerKey]: '' }))
      await load()
      onAlert('success', `${providerKey} key saved — brains using this provider are now active`)
    } catch (e) {
      onAlert('error', e.message)
    } finally {
      setSaving(s => ({ ...s, [providerKey]: false }))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{ padding: '12px 16px', borderStyle: 'dashed', marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--text-secondary)' }}>Runtime keys:</strong> Set here to activate providers instantly — no restart needed.
          Keys are stored in memory only and cleared on backend restart. For persistence, add them to your <code style={{ color: 'var(--accent-cyan)' }}>.env</code> file.
        </div>
      </div>

      {Object.entries(PROVIDERS).filter(([p]) => p !== 'none').map(([p, meta]) => {
        const pKey    = meta.providerKey
        const status  = keys[pKey] || {}
        const active  = status.configured
        const source  = status.source   // 'runtime' | 'env' | 'none'
        const isSaving = saving[pKey]

        return (
          <div key={p} className="card" style={{
            borderTop: `3px solid ${active ? meta.color : 'var(--border)'}`,
            opacity: 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              {/* Icon */}
              <div style={{
                width: 48, height: 48, borderRadius: 10, flexShrink: 0,
                background: active ? `${meta.color}18` : 'var(--bg-secondary)',
                border: `1px solid ${active ? meta.color + '40' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, color: active ? meta.color : 'var(--text-muted)',
              }}>
                {meta.icon}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{meta.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta.sublabel}</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                    background: active ? `${meta.color}20` : 'rgba(100,116,139,0.12)',
                    color: active ? meta.color : 'var(--text-muted)',
                    border: `1px solid ${active ? meta.color + '40' : 'transparent'}`,
                  }}>
                    {active ? (source === 'env' ? 'ENV KEY' : 'CONFIGURED') : 'NOT SET'}
                  </span>
                </div>

                {/* Key/URL input */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ flex: 1 }}>
                    <KeyInput
                      value={inputs[pKey] || ''}
                      onChange={v => setInputs(i => ({ ...i, [pKey]: v }))}
                      placeholder={active ? (source === 'env' ? 'Set via .env (override here)' : '••••••••  (already set — enter new to replace)') : meta.keyHint}
                      disabled={isSaving}
                    />
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleSave(pKey, meta.keyField)}
                    disabled={isSaving || !inputs[pKey]?.trim()}
                    style={{ flexShrink: 0 }}
                  >
                    {isSaving ? '…' : 'Save'}
                  </button>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: p === 'ollama' ? 12 : 0 }}>{meta.tip}</div>

                {/* Ollama model manager */}
                {p === 'ollama' && (
                  <OllamaModelManager compact />
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ── Config Modal ──────────────────────────────────────────────────────────
function ConfigModal({ brain, onClose, onSave }) {
  const [provider,    setProvider]    = useState(brain.provider)
  const [model,       setModel]       = useState(brain.model)
  const [testing,     setTesting]     = useState(false)
  const [testResult,  setTestResult]  = useState(null)
  const [providerStatus, setProviderStatus] = useState({})

  useEffect(() => {
    api.getProviderKeys().then(setProviderStatus).catch(() => {})
  }, [])

  const handleProviderChange = (p) => {
    setProvider(p)
    setModel(PROVIDERS[p]?.models[0] || '')
    setTestResult(null)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      await api.configureBrain(brain.role, { provider, model })
      const r = await api.testBrain(brain.role)
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, reason: e.message })
    } finally { setTesting(false) }
  }

  const meta = BRAIN_META[brain.role]
  const provMeta = PROVIDERS[provider] || PROVIDERS.none
  const pKey = provMeta.providerKey
  const keyStatus = pKey ? providerStatus[pKey] : null
  const keyOk = provider === 'none' || provider === 'ollama' || keyStatus?.configured

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
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

          {/* Provider grid — 5 tiles */}
          <div className="form-group">
            <label className="form-label">Provider</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {Object.entries(PROVIDERS).map(([p, pm]) => {
                const pStatus = pm.providerKey ? providerStatus[pm.providerKey] : null
                const hasKey  = p === 'none' || p === 'ollama' || pStatus?.configured
                return (
                  <div
                    key={p}
                    onClick={() => handleProviderChange(p)}
                    style={{
                      padding: '10px 6px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                      border: `2px solid ${provider === p ? pm.color : 'var(--border)'}`,
                      background: provider === p ? `${pm.color}15` : 'var(--bg-primary)',
                      transition: 'all 0.15s', position: 'relative',
                    }}
                  >
                    {/* configured dot */}
                    {p !== 'none' && (
                      <div style={{
                        position: 'absolute', top: 5, right: 5,
                        width: 6, height: 6, borderRadius: '50%',
                        background: hasKey ? pm.color : 'var(--border)',
                        boxShadow: hasKey ? `0 0 4px ${pm.color}` : 'none',
                      }} />
                    )}
                    <div style={{ fontSize: 17, marginBottom: 2 }}>{pm.icon}</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: provider === p ? pm.color : 'var(--text-muted)', lineHeight: 1.2 }}>
                      {pm.label.toUpperCase()}
                    </div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 1 }}>
                      {pm.sublabel}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Model selector */}
          {provider !== 'none' && (
            <div className="form-group">
              <label className="form-label">Model</label>
              <input
                className="form-input"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder={provMeta.models[0] || 'model name'}
                list={`models-${brain.role}`}
              />
              <datalist id={`models-${brain.role}`}>
                {provMeta.models.map(m => <option key={m} value={m} />)}
              </datalist>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {provMeta.models.map(m => (
                  <span
                    key={m}
                    className="condition-chip"
                    style={{ cursor: 'pointer', fontSize: 10, opacity: model === m ? 1 : 0.65 }}
                    onClick={() => setModel(m)}
                  >{m}</span>
                ))}
              </div>
            </div>
          )}

          {/* Key status / tip */}
          {provider !== 'none' && provider !== 'ollama' && (
            <div style={{
              padding: '8px 12px', borderRadius: 6, fontSize: 12,
              background: keyOk ? `${provMeta.color}08` : 'rgba(239,68,68,0.06)',
              border: `1px solid ${keyOk ? provMeta.color + '25' : 'rgba(239,68,68,0.25)'}`,
              color: 'var(--text-secondary)',
            }}>
              {!keyOk && (
                <div style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 4 }}>
                  ◬ No {provMeta.label} key configured — go to the Provider Keys tab to add one.
                </div>
              )}
              {keyOk && keyStatus?.source === 'env' && (
                <div style={{ color: provMeta.color, fontWeight: 600, marginBottom: 4 }}>
                  ◉ Key loaded from .env
                </div>
              )}
              {keyOk && keyStatus?.source === 'runtime' && (
                <div style={{ color: provMeta.color, fontWeight: 600, marginBottom: 4 }}>
                  ◉ Key set at runtime (Provider Keys tab)
                </div>
              )}
              <span>{provMeta.tip}</span>
            </div>
          )}

          {/* Ollama — model manager inline */}
          {provider === 'ollama' && (
            <div style={{
              padding: '12px 14px', borderRadius: 6,
              background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
            }}>
              <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600, marginBottom: 2 }}>
                ⊕ Host: {keyStatus?.host || 'http://localhost:11434'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                No API key required. Click an installed model to select it, or pull a new one below.
              </div>
              <OllamaModelManager compact onSelectModel={setModel} />
            </div>
          )}

          {/* Test result */}
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
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleTest}
            disabled={testing || provider === 'none' || !keyOk}
            title={!keyOk ? 'Add a provider key first' : ''}
          >
            {testing ? '… Testing' : '◎ Test Brain'}
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


// ── Brain Card ────────────────────────────────────────────────────────────
function BrainCard({ brain, onConfigure }) {
  const meta   = BRAIN_META[brain.role] || {}
  const prov   = PROVIDERS[brain.provider] || PROVIDERS.none
  const active = brain.enabled && brain.configured
  const stats  = brain.stats || {}

  return (
    <div className="card" style={{
      borderTop: `3px solid ${active ? meta.color : 'var(--border)'}`,
      opacity: active ? 1 : 0.75,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
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
              background: active ? `${prov.color}20` : 'rgba(100,116,139,0.12)',
              color: active ? prov.color : 'var(--text-muted)',
              border: `1px solid ${active ? prov.color + '40' : 'transparent'}`,
            }}>
              {active
                ? `${prov.icon} ${brain.provider.toUpperCase()}`
                : brain.enabled ? 'NO KEY' : 'INACTIVE'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            {meta.tagline}
          </div>

          {brain.enabled && (
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 11, color: active ? prov.color : 'var(--text-muted)',
              padding: '3px 8px', background: 'var(--bg-primary)', borderRadius: 5,
              border: '1px solid var(--border)', display: 'inline-block', marginBottom: 10,
            }}>
              {brain.model}
            </div>
          )}

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


// ── Recommendation Card ───────────────────────────────────────────────────
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


// ── Main Page ─────────────────────────────────────────────────────────────
export default function BrainCenter({ onAlert }) {
  const [brains,        setBrains]        = useState([])
  const [recs,          setRecs]          = useState([])
  const [loading,       setLoading]       = useState(true)
  const [configModal,   setConfigModal]   = useState(null)
  const [tab,           setTab]           = useState('brains')
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
    } catch (e) { console.error('loadRecs:', e) }
  }

  const load = async () => {
    await loadBrains()
    loadRecs()
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (role, provider, model) => {
    try {
      await api.configureBrain(role, { provider, model })
      await load()
      onAlert('success', `${role} brain → ${provider} / ${model || 'default'}`)
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

  const TABS = [
    ['brains',       '◈ Brains'],
    ['provider-keys','◐ Provider Keys'],
    ['recommendations', `▣ Recommendations${pendingRecs > 0 ? ` (${pendingRecs})` : ''}`],
  ]

  return (
    <div className="page">
      <div className="page-header">
        <h2>Brain Command Center</h2>
        <p>Five specialized AI agents — each independently configured per task, provider, and model</p>
      </div>

      {/* Architecture diagram */}
      <div className="card" style={{ marginBottom: 24, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto' }}>
          {ROLES.map((role, i) => {
            const b    = brains.find(x => x.role === role)
            const meta = BRAIN_META[role]
            const on   = b?.enabled && b?.configured
            return (
              <div key={role} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
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
          {TABS.map(([id, label]) => (
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
            {runningPolicy ? '▣ Running…' : '▣ Run Policy Brain'}
          </button>
        )}
      </div>

      {/* Tab content */}
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
              Detection event → <span style={{ color: BRAIN_META.triage.color }}>◇ Triage</span> classifies it →
              <span style={{ color: BRAIN_META.detection.color }}> ◉ Detection</span> deep-analyzes it →
              if high risk, <span style={{ color: BRAIN_META.mitigation.color }}>⊛ Mitigation</span> responds.<br />
              Activity event → <span style={{ color: BRAIN_META.risk.color }}>△ Risk</span> scores it →
              policy violation → <span style={{ color: BRAIN_META.mitigation.color }}>⊛ Mitigation</span> decides action.<br />
              Every 30 min → <span style={{ color: BRAIN_META.policy.color }}>▣ Policy</span> scans violations and drafts governance rules.
            </div>
          </div>
        </div>
      ) : tab === 'provider-keys' ? (
        <ProviderKeysPanel onAlert={onAlert} />
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
