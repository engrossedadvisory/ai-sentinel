import { useState, useEffect } from 'react'
import { api } from '../api/client'

const TYPE_ICONS = {
  new_deployment:      '⊕',
  capability_expansion:'⇑',
  unauthorized_access: '◬',
  anomalous_behavior:  '◈',
  policy_violation:    '⊟',
}

const CONFIDENCE_COLOR = (c) => {
  if (c >= 0.9) return 'var(--danger)'
  if (c >= 0.7) return 'var(--warning)'
  return 'var(--accent-blue)'
}

export default function DetectionPanel({ wsEvent, onAlert }) {
  const [detections, setDetections] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ status: '', detection_type: '' })
  const [selected, setSelected] = useState(null)

  const load = async () => {
    try {
      const params = {}
      if (filter.status) params.status = filter.status
      if (filter.detection_type) params.detection_type = filter.detection_type
      setDetections(await api.getDetections(params))
    } catch (e) { onAlert('error', e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filter])

  useEffect(() => {
    if (wsEvent?.type === 'new_detection') {
      setDetections(prev => [wsEvent.data, ...prev])
    }
  }, [wsEvent])

  const updateStatus = async (id, status) => {
    try {
      await api.updateDetectionStatus(id, status)
      await load()
      if (selected?.id === id) setSelected(null)
      onAlert('success', `Detection marked as ${status}`)
    } catch (e) { onAlert('error', e.message) }
  }

  const borderColor = (d) => {
    if (d.confidence >= 0.9) return 'var(--danger)'
    if (d.confidence >= 0.7) return 'var(--warning)'
    return 'var(--accent-blue)'
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Detection Panel</h2>
        <p>Newly discovered AI deployments and anomalous behaviors requiring investigation</p>
      </div>

      <div className="toolbar">
        <select className="form-select" style={{ width: 160 }} value={filter.status} onChange={e => setFilter(p => ({ ...p, status: e.target.value }))}>
          <option value="">All Statuses</option>
          {['new', 'investigating', 'confirmed', 'resolved', 'false_positive'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="form-select" style={{ width: 200 }} value={filter.detection_type} onChange={e => setFilter(p => ({ ...p, detection_type: e.target.value }))}>
          <option value="">All Types</option>
          {['new_deployment', 'capability_expansion', 'unauthorized_access', 'anomalous_behavior'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <div className="toolbar-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 16 }}>
        <div>
          {loading ? (
            <div className="loading"><div className="spinner" /></div>
          ) : detections.length === 0 ? (
            <div className="empty-state card"><div className="icon">◎</div><p>No detections found</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {detections.map(d => (
                <div
                  key={d.id}
                  className="card"
                  style={{
                    padding: '14px 16px', cursor: 'pointer',
                    borderLeft: `3px solid ${borderColor(d)}`,
                    outline: selected?.id === d.id ? `1px solid ${borderColor(d)}` : 'none',
                  }}
                  onClick={() => setSelected(selected?.id === d.id ? null : d)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{TYPE_ICONS[d.detection_type] || '◎'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, textTransform: 'capitalize' }}>
                          {d.detection_type.replace(/_/g, ' ')}
                        </span>
                        <span className={`badge badge-${d.status}`}>{d.status}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(d.detected_at).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        via <strong>{d.source}</strong>
                        {d.entity?.name && <> · <span style={{ fontFamily: 'var(--mono)' }}>{d.entity.name}</span></>}
                        {d.entity?.agent_id && !d.entity?.name && <> · <span style={{ fontFamily: 'var(--mono)' }}>{d.entity.agent_id}</span></>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: CONFIDENCE_COLOR(d.confidence) }}>
                        {Math.round(d.confidence * 100)}%
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>confidence</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="card" style={{ height: 'fit-content', position: 'sticky', top: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Detection #{selected.id}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>TYPE</div>
              <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{selected.detection_type.replace(/_/g, ' ')}</div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>SOURCE</div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{selected.source}</span>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>CONFIDENCE</div>
              <div className="confidence">
                <div className="confidence-bar">
                  <div className="confidence-fill" style={{
                    width: `${selected.confidence * 100}%`,
                    background: CONFIDENCE_COLOR(selected.confidence)
                  }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: CONFIDENCE_COLOR(selected.confidence), width: 40, textAlign: 'right' }}>
                  {Math.round(selected.confidence * 100)}%
                </span>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>ENTITY</div>
              <pre style={{
                fontSize: 11, fontFamily: 'var(--mono)', background: 'var(--bg-primary)',
                padding: 10, borderRadius: 6, color: 'var(--text-secondary)',
                overflow: 'auto', maxHeight: 160,
              }}>
                {JSON.stringify(selected.entity, null, 2)}
              </pre>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>RISK ASSESSMENT</div>
              <pre style={{
                fontSize: 11, fontFamily: 'var(--mono)', background: 'var(--bg-primary)',
                padding: 10, borderRadius: 6, color: 'var(--text-secondary)',
                overflow: 'auto', maxHeight: 120,
              }}>
                {JSON.stringify(selected.risk_assessment, null, 2)}
              </pre>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>UPDATE STATUS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['investigating', 'confirmed', 'resolved', 'false_positive'].map(s => (
                <button
                  key={s}
                  className={`btn btn-sm btn-ghost`}
                  style={{ fontSize: 11 }}
                  onClick={() => updateStatus(selected.id, s)}
                  disabled={selected.status === s}
                >
                  {s.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
