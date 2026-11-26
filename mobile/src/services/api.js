function normalizeBaseUrl(rawUrl) {
  return (rawUrl || '').trim().replace(/\/+$/, '');
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

export async function linkDevice(baseUrl, watchId, token) {
  const url = `${normalizeBaseUrl(baseUrl)}/watches/${encodeURIComponent(watchId.trim())}/devices`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return parseApiResponse(res);
}

export async function unlinkDevice(baseUrl, watchId, token) {
  const url = `${normalizeBaseUrl(baseUrl)}/watches/${encodeURIComponent(watchId.trim())}/devices`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return parseApiResponse(res);
}

export async function triggerTestAlarm(baseUrl, watchId) {
  const url = `${normalizeBaseUrl(baseUrl)}/watches/${encodeURIComponent(watchId.trim())}/test-alarm`;
  const res = await fetch(url, {
    method: 'POST',
  });
  return parseApiResponse(res);
}
