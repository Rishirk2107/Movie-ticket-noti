export const MAX_DATE_RANGE_DAYS = 14;

/**
 * Get today's date formatted as YYYY-MM-DD in IST (UTC+5:30).
 */
export function todayIST() {
  const now = new Date();
  const istTime = new Date(now.getTime() + (5 * 60 + 30) * 60000);
  const y = istTime.getUTCFullYear();
  const m = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(istTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a YYYY-MM-DD string into a local Date instance without UTC conversion.
 */
export function parseLocalDate(isoStr) {
  if (!isoStr || typeof isoStr !== 'string') return null;
  const parts = isoStr.trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

/**
 * Format a local Date instance into YYYY-MM-DD.
 */
export function formatLocalDate(dt) {
  if (!dt || Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Add N days to a YYYY-MM-DD string cleanly without UTC day-shift bugs.
 */
export function addDays(isoStr, days) {
  const dt = parseLocalDate(isoStr);
  if (!dt) return isoStr || '';
  dt.setDate(dt.getDate() + days);
  return formatLocalDate(dt);
}

/**
 * Compute whole-day difference (endIso - startIso). Returns null if invalid.
 */
export function daysBetween(startIso, endIso) {
  const startDt = parseLocalDate(startIso);
  const endDt = parseLocalDate(endIso);
  if (!startDt || !endDt) return null;
  return Math.round((endDt.getTime() - startDt.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Convert 8-digit YYYYMMDD to YYYY-MM-DD.
 */
export function fmt8toISO(d8) {
  if (!d8 || typeof d8 !== 'string') return '';
  const clean = d8.trim();
  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  return clean;
}

/**
 * Format YYYY-MM-DD or YYYYMMDD for readable display (e.g. "2026-12-18" or "18 Dec 2026").
 */
export function formatDateCode(dateVal) {
  if (!dateVal || typeof dateVal !== 'string') return 'Selected Dates';
  const iso = fmt8toISO(dateVal);
  const dt = parseLocalDate(iso);
  if (!dt) return dateVal;
  return dt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function isValidIsoDate(isoStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test((isoStr || '').trim()) && parseLocalDate(isoStr) !== null;
}

export function isValidHttpUrl(raw) {
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test((raw || '').trim());
}
