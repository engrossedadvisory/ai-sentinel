const BASE = '/api'

// Module-level demo mode flag — set via setDemoMode(), read by all calls
let _demoMode = true
export const setDemoMode = (v) => { _demoMode = v }
export const getDemoMode  = ()  => _demoMode

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  if (res.status === 204) return null
  return res.json()
}

const dm = () => `demo_mode=${_demoMode}`

export const api = {
  // Dashboard
  getStats:           ()            => request(`/dashboard/stats?${dm()}`),
  getActivityChart:   (hours = 24)  => request(`/dashboard/activity-chart?hours=${hours}&${dm()}`),
  getRecentViolations:(limit = 8)   => request(`/dashboard/recent-violations?limit=${limit}&${dm()}`),
  getRecentDetections:(limit = 5)   => request(`/dashboard/recent-detections?limit=${limit}&${dm()}`),

  // Agents
  getAgents: (params = {}) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)), demo_mode: _demoMode })
    return request(`/agents?${q}`)
  },
  getAgent:        (id)       => request(`/agents/${id}`),
  createAgent:     (data)     => request('/agents',             { method: 'POST', body: data }),
  updateAgent:     (id, data) => request(`/agents/${id}`,       { method: 'PUT',  body: data }),
  authorizeAgent:  (id)       => request(`/agents/${id}/authorize`,  { method: 'POST' }),
  quarantineAgent: (id)       => request(`/agents/${id}/quarantine`, { method: 'POST' }),
  suspendAgent:    (id)       => request(`/agents/${id}/suspend`,    { method: 'POST' }),
  deleteAgent:     (id)       => request(`/agents/${id}`,       { method: 'DELETE' }),

  // Policies
  getPolicies:    ()          => request('/policies'),
  getPolicy:      (id)        => request(`/policies/${id}`),
  createPolicy:   (data)      => request('/policies',           { method: 'POST', body: data }),
  updatePolicy:   (id, data)  => request(`/policies/${id}`,     { method: 'PUT',  body: data }),
  togglePolicy:   (id)        => request(`/policies/${id}/toggle`, { method: 'POST' }),
  deletePolicy:   (id)        => request(`/policies/${id}`,     { method: 'DELETE' }),

  // Activities
  getActivities: (params = {}) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)), demo_mode: _demoMode })
    return request(`/activities?${q}`)
  },
  reportActivity: (data) => request('/activities', { method: 'POST', body: data }),

  // Detections
  getDetections: (params = {}) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)), demo_mode: _demoMode })
    return request(`/detections?${q}`)
  },
  reportDetection:      (data)         => request('/detections/report',           { method: 'POST', body: data }),
  updateDetectionStatus:(id, status)   => request(`/detections/${id}/status`,     { method: 'PUT',  body: { status } }),

  // AI Brains
  getAIStatus:          ()             => request('/ai/status'),
  getBrains:            ()             => request('/ai/brains'),
  getBrain:             (role)         => request(`/ai/brains/${role}`),
  configureBrain:       (role, data)   => request(`/ai/brains/${role}/configure`, { method: 'POST', body: data }),
  testBrain:            (role)         => request(`/ai/brains/${role}/test`,       { method: 'POST' }),
  runPolicyBrain:       ()             => request('/ai/brains/policy/run',          { method: 'POST' }),
  getRecommendations:   (status)       => request(`/ai/recommendations${status ? '?status=' + status : ''}`),
  acceptRecommendation: (id)           => request(`/ai/recommendations/${id}/accept`, { method: 'POST' }),
  rejectRecommendation: (id)           => request(`/ai/recommendations/${id}/reject`, { method: 'POST' }),

  // Provider key management
  getProviderKeys: ()                           => request('/ai/provider-keys'),
  setProviderKey:  (provider, api_key, base_url) =>
    request('/ai/provider-keys', { method: 'POST', body: { provider, api_key, base_url } }),

  // Ollama model management
  getOllamaModels:     ()      => request('/ai/ollama/models'),
  pullOllamaModel:     (model) => request('/ai/ollama/pull',                    { method: 'POST', body: { model } }),
  getOllamaPullStatus: (model) => request(`/ai/ollama/pull/status/${encodeURIComponent(model)}`),

  // Mitigations
  getMitigations: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null))
    return request(`/mitigations${q.toString() ? '?' + q : ''}`)
  },
  createMitigation: (data) => request('/mitigations', { method: 'POST', body: data }),
  getViolations: (params = {}) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)), demo_mode: _demoMode })
    return request(`/mitigations/violations/all?${q}`)
  },
  updateViolationStatus: (id, status) =>
    request(`/mitigations/violations/${id}/status?status=${status}`, { method: 'PUT' }),
}
