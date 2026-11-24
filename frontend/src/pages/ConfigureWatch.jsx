import React, { useState, useEffect } from 'react'
import { useSearchParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { api } from '../services/api'
import EmailChipInput from '../components/EmailChipInput'
import {
  getTodayIST,
  addDays,
  fmt8toISO,
  formatDisplayDate,
  parseLocalDate,
} from '../utils/dateUtils'

export default function ConfigureWatch() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  const eventCode = searchParams.get('eventCode') || ''
  const movieState = location.state?.movie || null

  // Synopsis State
  const [synopsis, setSynopsis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Selected Format State
  const [selectedOption, setSelectedOption] = useState(null)

  // Watch Form State
  const [label, setLabel] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [includePreview, setIncludePreview] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState(10)
  const [emails, setEmails] = useState([])

  // Submission State
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Fetch synopsis for eventCode
  useEffect(() => {
    if (!eventCode) {
      setError('No event code provided. Please pick a movie from the catalog.')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api
      .getSynopsis(eventCode, controller.signal)
      .then((data) => {
        setSynopsis(data)
        setLoading(false)

        // Select first format option by default if available
        const opts = data.options || []
        if (opts.length > 0) {
          setSelectedOption(opts[0])
          updateDefaultLabel(data.movie_name || movieState?.title || eventCode, opts[0])
        } else {
          setLabel(data.movie_name || movieState?.title || eventCode)
        }

        // Initialize Dates cleanly based on IST rules
        // Default to opening_date_iso (early screenings) or release_date_iso, fallback to todayIST
        const todayIST = getTodayIST()
        const effectiveStart = data.opening_date_iso || data.release_date_iso || todayIST
        // Ensure default start date is not earlier than today
        const initialStart = effectiveStart >= todayIST ? effectiveStart : todayIST
        setStartDate(initialStart)
        setEndDate(initialStart)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message || 'Failed to load movie formats and release dates.')
        setLoading(false)
      })

    return () => controller.abort()
  }, [eventCode])

  // Update default label when format option changes
  const updateDefaultLabel = (movieTitle, opt) => {
    if (!opt) return
    const formatSuffix = opt.label || `${opt.language} ${opt.dimension}`
    setLabel(`${movieTitle} - ${formatSuffix}`)
  }

  const handleSelectFormat = (opt) => {
    setSelectedOption(opt)
    const movieTitle = synopsis?.movie_name || movieState?.title || eventCode
    updateDefaultLabel(movieTitle, opt)
  }

  // Handle Start Date Change & Enforce Range Bounds
  const handleStartDateChange = (newStart) => {
    setStartDate(newStart)
    const maxEnd = addDays(newStart, 14)
    if (!endDate || endDate < newStart || endDate > maxEnd) {
      setEndDate(newStart)
    }
  }

  // Handle Include Preview Toggle
  const handleTogglePreview = (checked) => {
    setIncludePreview(checked)
    if (!checked) return

    // Determine the release date
    const releaseIso =
      synopsis?.release_date_iso ||
      (synopsis?.release_date_8digit ? fmt8toISO(synopsis.release_date_8digit) : null)

    if (releaseIso) {
      const previewIso = addDays(releaseIso, -1)
      const todayIST = getTodayIST()
      // Shift start_date back by 1 day if earlier and not in the past
      if (previewIso >= todayIST && previewIso < startDate) {
        handleStartDateChange(previewIso)
      }
    }
  }

  // Submit Watch
  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError(null)

    if (!label.trim()) {
      setSubmitError('Watch label is required.')
      return
    }

    if (!startDate) {
      setSubmitError('Start date is required.')
      return
    }

    if (endDate && endDate < startDate) {
      setSubmitError('End date cannot be earlier than start date.')
      return
    }

    const startDt = parseLocalDate(startDate)
    const endDt = parseLocalDate(endDate || startDate)
    const diffDays = Math.round((endDt - startDt) / (1000 * 60 * 60 * 24))
    if (diffDays > 14) {
      setSubmitError('Date range cannot exceed 14 days.')
      return
    }

    if (intervalMinutes < 1) {
      setSubmitError('Check interval must be at least 1 minute.')
      return
    }

    setSubmitting(true)

    const payload = {
      ref_event_code: selectedOption?.ref_event_code || eventCode,
      et_codes: selectedOption?.event_code || '*',
      language: (selectedOption?.language || 'english').toLowerCase(),
      label: label.trim(),
      start_date: startDate,
      end_date: endDate || startDate,
      interval_minutes: parseInt(intervalMinutes, 10) || 10,
      emails: [...emails],
      include_preview: includePreview,
    }

    try {
      await api.createWatch(payload)
      // Successfully created, navigate straight to /watches dashboard
      navigate('/watches')
    } catch (err) {
      setSubmitError(err.message || 'Failed to register watch. Please check your inputs.')
      setSubmitting(false)
    }
  }

  const todayIST = getTodayIST()
  const maxAllowedEnd = startDate ? addDays(startDate, 14) : ''

  if (loading) {
    return (
      <div className="page-container">
        <div className="card loading-card">
          <div className="spinner"></div>
          <p className="text-muted">Loading movie formats & scheduling data...</p>
        </div>
      </div>
    )
  }

  if (error || !synopsis) {
    return (
      <div className="page-container">
        <div className="card error-card">
          <div className="error-title">Unable to Load Movie Details</div>
          <p className="error-desc">{error || 'Movie details not found.'}</p>
          <div className="card-actions">
            <Link to="/movies" className="btn btn-secondary">
              &larr; Back to Movies
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const movieName = synopsis.movie_name || movieState?.title || eventCode
  const options = synopsis.options || []
  const hasEarlyOpening =
    synopsis.opening_date_iso &&
    synopsis.release_date_iso &&
    synopsis.opening_date_iso < synopsis.release_date_iso

  return (
    <div className="page-container">
      {/* Top Breadcrumb Header */}
      <div className="configure-header">
        <Link to="/movies" className="back-link">
          &larr; Browse Movies
        </Link>
        <h1 className="page-title">{movieName}</h1>
      </div>

      <form onSubmit={handleSubmit} className="configure-layout">
        {/* SECTION 1: Language & Format Picker + Date Info */}
        <div className="card section-card">
          <div className="section-title">
            <span className="step-num">1</span> Language & Format Selection
          </div>

          {/* Date info pill */}
          <div className="date-info-banner">
            {hasEarlyOpening ? (
              <div>
                <span className="early-badge">Early Screenings Available</span>
                <strong>Opening Date:</strong> {formatDisplayDate(synopsis.opening_date_iso)}{' '}
                &nbsp;&middot;&nbsp; <strong>Wide Release:</strong>{' '}
                {formatDisplayDate(synopsis.release_date_iso)}
              </div>
            ) : synopsis.release_date_iso ? (
              <div>
                <strong>Official Release Date:</strong>{' '}
                {formatDisplayDate(synopsis.release_date_iso)}
              </div>
            ) : (
              <div>Pre-booking watch mode (alert as soon as tickets go live)</div>
            )}
          </div>

          <label className="form-label">Available Screen Formats in Chennai:</label>
          {options.length === 0 ? (
            <div className="empty-formats">
              No specific format options returned yet. The watch will automatically monitor all formats (*).
            </div>
          ) : (
            <div className="format-chips-grid">
              {options.map((opt, i) => {
                const isSelected = selectedOption === opt
                return (
                  <button
                    key={i}
                    type="button"
                    className={`format-chip ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectFormat(opt)}
                  >
                    <span className="chip-label">{opt.label}</span>
                    <span className="chip-code">{opt.event_code}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* SECTION 2: Watch & Date Configuration */}
        <div className="card section-card">
          <div className="section-title">
            <span className="step-num">2</span> Watch & Schedule Configuration
          </div>

          <div className="form-group">
            <label className="form-label">
              Watch Label <span className="req">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Dune: Part Three - IMAX 2D Chennai"
              required
            />
            <span className="form-hint">
              A distinctive name displayed in notifications and active watches.
            </span>
          </div>

          <div className="form-row">
            <div className="form-group flex-1">
              <label className="form-label">
                Start Date <span className="req">*</span>
              </label>
              <input
                type="date"
                className="form-input"
                min={todayIST}
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                required
              />
              <span className="form-hint">Defaults to earliest available opening date.</span>
            </div>

            <div className="form-group flex-1">
              <label className="form-label">
                End Date <span className="req">*</span>
              </label>
              <input
                type="date"
                className="form-input"
                min={startDate || todayIST}
                max={maxAllowedEnd}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
              <span className="form-hint">Up to 14 days from Start Date.</span>
            </div>
          </div>

          {/* Include Day-Before Preview Toggle */}
          <div className="toggle-container">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={includePreview}
                onChange={(e) => handleTogglePreview(e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
            <div className="toggle-label-wrap">
              <span className="toggle-label">Include day-before preview (releaseDate − 1)</span>
              <span className="toggle-subtext">
                Automatically checks for early preview screenings scheduled on the eve of release.
              </span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Check Interval (Minutes)</label>
            <input
              type="number"
              className="form-input"
              min="1"
              max="1440"
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(e.target.value)}
              required
            />
            <span className="form-hint">
              Frequency of BookMyShow schedule checks (default: 10 mins).
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Alert Emails</label>
            <EmailChipInput emails={emails} onChange={setEmails} />
            <span className="form-hint">
              Configured email addresses will receive instant notification alerts when new theatres open bookings.
            </span>
          </div>

          {submitError && <div className="alert alert-error">{submitError}</div>}

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary btn-large"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <span className="spinner-small"></span> Setting up watch...
                </>
              ) : (
                'Create Ticket Watch'
              )}
            </button>
            <Link to="/movies" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  )
}
