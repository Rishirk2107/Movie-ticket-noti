export const DEFAULT_BACKEND_URL = 'https://movie-ticket-noti.onrender.com';

function normalizeBaseUrl(rawUrl) {
  return (rawUrl || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, '');
}

async function parseApiResponse(res) {
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const detail =
      (json && (json.detail || json.message || json.error)) ||
      `Request failed (${res.status})`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  return json;
}

async function request(baseUrl, path, options = {}) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    throw new Error('Backend URL is not configured.');
  }
  const res = await fetch(`${base}${path}`, options);
  return parseApiResponse(res);
}

export function getHealth(baseUrl) {
  return request(baseUrl, '/health', { method: 'GET' });
}

export function getMovies(baseUrl) {
  return request(baseUrl, '/api/bms/movies', { method: 'GET' });
}

export function getSynopsis(baseUrl, eventCode) {
  return request(
    baseUrl,
    `/api/bms/synopsis?eventcode=${encodeURIComponent((eventCode || '').trim())}`,
    { method: 'GET' }
  );
}

export function getWatches(baseUrl) {
  return request(baseUrl, '/watches', { method: 'GET' });
}

export function createWatch(baseUrl, payload) {
  return request(baseUrl, '/watches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function deleteWatch(baseUrl, watchId) {
  return request(baseUrl, `/watches/${encodeURIComponent(watchId)}`, {
    method: 'DELETE',
  });
}

export function getWatchVenues(baseUrl, watchId) {
  return request(baseUrl, `/watches/${encodeURIComponent(watchId)}/venues`, {
    method: 'GET',
  });
}

export function linkDevice(baseUrl, watchId, token) {
  return request(baseUrl, `/watches/${encodeURIComponent(watchId.trim())}/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export function unlinkDevice(baseUrl, watchId, token) {
  return request(baseUrl, `/watches/${encodeURIComponent(watchId.trim())}/devices`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export function triggerTestAlarm(baseUrl, watchId) {
  return request(baseUrl, `/watches/${encodeURIComponent(watchId.trim())}/test-alarm`, {
    method: 'POST',
  });
}

export function getLogs(baseUrl, limit = 50) {
  return request(baseUrl, `/logs?limit=${encodeURIComponent(limit)}`, {
    method: 'GET',
  });
}
