const BASE = '/api'

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

export const api = {
  // Dashboard
  getStats: () => request('/dashboard/stats'),
  getActivityChart: (hours = 24) => request(`/dashboard/activity-chart?hours=${hours}`),
  getRecentViolations: (limit = 8) => request(`/dashboard/recent-violations?limit=${limit}`),
  getRecentDetections: (limit = 5) => request(`/dashboard/recent-detections?limit=${limit}`),

  // Agents
  getAgents: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null))
    return request(`/agents${q.toString() ? '?' + q : ''}`)
  },
  getAgent: (id) => request(`/agents/${id}`),
  createAgent: (data) => request('/agents', { method: 'POST', body: data }),
  updateAgent: (id, data) => request(`/agents/${id}`, { method: 'PUT', body: data }),
  authorizeAgent: (id) => request(`/agents/${id}/authorize`, { method: 'POST' }),
  quarantineAgent: (id) => request(`/agents/${id}/quarantine`, { method: 'POST' }),
  suspendAgent: (id) => request(`/agents/${id}/suspend`, { method: 'POST' }),
  deleteAgent: (id) => request(`/agents/${id}`, { method: 'DELETE' }),

  // Policies
  getPolicies: () => request('/policies'),
  getPolicy: (id) => request(`/policies/${id}`),
  createPolicy: (data) => request('/policies', { method: 'POST', body: data }),
  updatePolicy: (id, data) => request(`/policies/${id}`, { method: 'PUT', body: data }),
  togglePolicy: (id) => request(`/policies/${id}/toggle`, { method: 'POST' }),
  deletePolicy: (id) => request(`/policies/${id}`, { method: 'DELETE' }),

  // Activities
  getActivities: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null))
    return request(`/activities${q.toString() ? '?' + q : ''}`)
  },
  reportActivity: (data) => request('/activities', { method: 'POST', body: data }),

  // Detections
  getDetections: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null))
    return request(`/detections${q.toString() ? '?' + q : ''}`)
  },
  reportDetection: (data) => request('/detections/report', { method: 'POST', body: data }),
  updateDetectionStatus: (id, status) => request(`/detections/${id}/status`, { method: 'PUT', body: { status } }),

  // AI Brains
  getAIStatus:          ()           => request('/ai/status'),
  getBrains:            ()           => request('/ai/brains'),
  getBrain:             (role)       => request(`/ai/brains/${role}`),
  configureBrain:       (role, data) => request(`/ai/brains/${role}/configure`, { method: 'POST', body: data }),
  testBrain:            (role)       => request(`/ai/brains/${role}/test`,      { method: 'POST' }),
  runPolicyBrain:       ()           => request('/ai/brains/policy/run',         { method: 'POST' }),
  getRecommendations:   (status)     => request(`/ai/recommendations${status ? '?status=' + status : ''}`),
  acceptRecommendation: (id)         => request(`/ai/recommendations/${id}/accept`, { method: 'POST' }),
  rejectRecommendation: (id)         => request(`/ai/recommendations/${id}/reject`, { method: 'POST' }),

  // Mitigations
  getMitigations: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null))
    return request(`/mitigations${q.toString() ? '?' + q : ''}`)
  },
  createMitigation: (data) => request('/mitigations', { method: 'POST', body: data }),
  getViolations: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null))
    return request(`/mitigations/violations/all${q.toString() ? '?' + q : ''}`)
  },
  updateViolationStatus: (id, status) =>
    request(`/mitigations/violations/${id}/status?status=${status}`, { method: 'PUT' }),
}
