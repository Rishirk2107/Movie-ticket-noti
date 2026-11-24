/**
 * Central API Client for BookMyShow Watcher Backend
 * Supports VITE_API_BASE_URL or defaults to empty string (same-origin / Vite proxy)
 */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function handleResponse(res) {
  if (!res.ok) {
    let errMsg = `Request failed: ${res.status} ${res.statusText}`
    try {
      const errJson = await res.json()
      if (errJson && errJson.detail) {
        errMsg = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail)
      }
    } catch {
      // not JSON
    }
    const error = new Error(errMsg)
    error.status = res.status
    throw error
  }
  return res.json()
}

export const api = {
  // Movie discovery list
  async getMovies(signal) {
    const res = await fetch(`${BASE_URL}/api/bms/movies`, { signal })
    return handleResponse(res)
  },

  // Movie synopsis & formats
  async getSynopsis(eventCode, signal) {
    const res = await fetch(
      `${BASE_URL}/api/bms/synopsis?eventcode=${encodeURIComponent(eventCode)}`,
      { signal }
    )
    return handleResponse(res)
  },

  // List all watches
  async getWatches(signal) {
    const res = await fetch(`${BASE_URL}/watches`, { signal })
    return handleResponse(res)
  },

  // Create watch
  async createWatch(payload) {
    const res = await fetch(`${BASE_URL}/watches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    return handleResponse(res)
  },

  // Delete watch
  async deleteWatch(watchId) {
    const res = await fetch(`${BASE_URL}/watches/${encodeURIComponent(watchId)}`, {
      method: 'DELETE',
    })
    return handleResponse(res)
  },

  // List venues for watch
  async getWatchVenues(watchId, signal) {
    const res = await fetch(
      `${BASE_URL}/watches/${encodeURIComponent(watchId)}/venues`,
      { signal }
    )
    return handleResponse(res)
  },

  // Real-time activity logs
  async getLogs(limit = 50, signal) {
    const res = await fetch(`${BASE_URL}/logs?limit=${limit}`, { signal })
    return handleResponse(res)
  },

  // System health
  async getHealth(signal) {
    const res = await fetch(`${BASE_URL}/health`, { signal })
    return handleResponse(res)
  },
}
