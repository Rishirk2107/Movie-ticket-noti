export const DEFAULT_BMS_FALLBACK_URL =
  'https://in.bookmyshow.com/explore/home/chennai';

/**
 * Normalize a raw URL string into a valid http(s) URL.
 */
export function normalizeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    return `https://in.bookmyshow.com${trimmed}`;
  }
  return `https://${trimmed}`;
}

/**
 * Resolve the best BookMyShow booking URL from alarmData and optional matching watch record.
 */
export function resolveAlarmBookingUrl(alarmData, watches = []) {
  const directCandidates = [
    alarmData?.showtimes_url,
    alarmData?.showtimesUrl,
    alarmData?.url,
    alarmData?.link,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeExternalUrl(candidate);
    if (normalized && !normalized.includes('/api/movies-data/')) {
      return normalized;
    }
  }

  // Fallback: look up matching watch from cached/loaded watches by watch_id
  if (alarmData?.watch_id && Array.isArray(watches)) {
    const matched = watches.find((w) => w?._id === alarmData.watch_id);
    if (matched) {
      const watchUrl = normalizeExternalUrl(matched.showtimes_url || matched.url);
      if (watchUrl && !watchUrl.includes('/api/movies-data/')) {
        return watchUrl;
      }
      if (matched.ref_event_code) {
        const dc =
          alarmData?.date_code ||
          (Array.isArray(matched.available_dates) && matched.available_dates[0]) ||
          '';
        const dateSegment = dc ? `/${dc}` : '';
        return `https://in.bookmyshow.com/movies/chennai/buytickets/${matched.ref_event_code}${dateSegment}`;
      }
    }
  }

  return DEFAULT_BMS_FALLBACK_URL;
}
