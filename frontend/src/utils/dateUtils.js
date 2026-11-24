/**
 * IST (Asia/Kolkata, UTC+5:30) & Local YYYY-MM-DD Date Helpers
 *
 * Rules:
 * - Never use new Date("YYYY-MM-DD") or .toISOString() directly for calculations
 *   to avoid UTC midnight vs IST off-by-one shifts.
 * - Always construct local dates via new Date(year, month - 1, day).
 */

/**
 * Get today's date formatted as YYYY-MM-DD in IST (UTC+5:30).
 */
export function getTodayIST() {
  const now = new Date()
  // Add 5h 30m in milliseconds to UTC time
  const istTime = new Date(now.getTime() + (5 * 60 + 30) * 60000)
  const y = istTime.getUTCFullYear()
  const m = String(istTime.getUTCMonth() + 1).padStart(2, '0')
  const d = String(istTime.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Parse a YYYY-MM-DD string into a local Date instance without UTC conversion.
 */
export function parseLocalDate(isoStr) {
  if (!isoStr || typeof isoStr !== 'string') return null
  const parts = isoStr.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return null
  const [y, m, d] = parts
  return new Date(y, m - 1, d)
}

/**
 * Format a local Date instance into YYYY-MM-DD.
 */
export function formatLocalDate(dt) {
  if (!dt || isNaN(dt.getTime())) return ''
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Add N days to an ISO string (YYYY-MM-DD) cleanly.
 */
export function addDays(isoStr, n) {
  const dt = parseLocalDate(isoStr)
  if (!dt) return isoStr
  dt.setDate(dt.getDate() + n)
  return formatLocalDate(dt)
}

/**
 * Format 8-digit YYYYMMDD into YYYY-MM-DD.
 */
export function fmt8toISO(d8) {
  if (!d8 || typeof d8 !== 'string' || d8.length < 8) return d8 || ''
  return `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}`
}

/**
 * Format YYYY-MM-DD or 8-digit YYYYMMDD for human display (e.g. "18 Dec 2026").
 */
export function formatDisplayDate(dateVal) {
  if (!dateVal) return ''
  let iso = dateVal
  if (typeof dateVal === 'string' && /^\d{8}$/.test(dateVal)) {
    iso = fmt8toISO(dateVal)
  }
  const dt = parseLocalDate(iso)
  if (!dt) return String(dateVal)
  return dt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
