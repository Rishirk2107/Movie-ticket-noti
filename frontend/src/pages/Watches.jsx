import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { formatDisplayDate } from '../utils/dateUtils'

export default function Watches() {
  const [watches, setWatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Theatres Modal State
  const [modalWatch, setModalWatch] = useState(null)
  const [venues, setVenues] = useState([])
  const [loadingVenues, setLoadingVenues] = useState(false)
  const [venueError, setVenueError] = useState(null)

  // Deletion feedback state
  const [deletingId, setDeletingId] = useState(null)

  const fetchWatches = (signal) => {
    setLoading(true)
    setError(null)
    api
      .getWatches(signal)
      .then((data) => {
        setWatches(data || [])
        setLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message || 'Failed to load watches.')
        setLoading(false)
      })
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchWatches(controller.signal)
    return () => controller.abort()
  }, [])

  const handleDelete = async (watchId, label) => {
    if (!window.confirm(`Are you sure you want to delete the watch "${label}"?`)) {
      return
    }
    setDeletingId(watchId)
    try {
      await api.deleteWatch(watchId)
      setWatches((prev) => prev.filter((w) => w._id !== watchId))
    } catch (err) {
      alert(`Failed to delete watch: ${err.message}`)
    } finally {
      setDeletingId(null)
    }
  }

  const handleOpenVenues = (watch) => {
    setModalWatch(watch)
    setLoadingVenues(true)
    setVenueError(null)
    setVenues([])

    api
      .getWatchVenues(watch._id)
      .then((data) => {
        setVenues(data || [])
        setLoadingVenues(false)
      })
      .catch((err) => {
        setVenueError(err.message || 'Failed to fetch theatres.')
        setLoadingVenues(false)
      })
  }

  const handleCloseModal = () => {
    setModalWatch(null)
    setVenues([])
  }

  const filteredWatches = watches.filter((w) => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return true
    return (
      (w.label && w.label.toLowerCase().includes(q)) ||
      (w.movie_name && w.movie_name.toLowerCase().includes(q)) ||
      (w.ref_event_code && w.ref_event_code.toLowerCase().includes(q))
    )
  })

  // Group venues by date_code for cleaner modal display
  const venuesByDate = venues.reduce((acc, v) => {
    const dateKey = v.date_code || 'General'
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(v)
    return acc
  }, {})

  return (
    <div className="page-container">
      {/* Header Banner */}
      <div className="hero-banner">
        <div>
          <h1 className="page-title">Active Ticket Watches</h1>
          <p className="page-subtitle">
            Registered BookMyShow watches monitoring schedules, dates, and newly opened screens.
          </p>
        </div>
        <div className="banner-actions">
          <Link to="/movies" className="btn btn-primary">
            + New Watch
          </Link>
          <Link to="/logs" className="btn btn-secondary">
            View Live Logs &rarr;
          </Link>
        </div>
      </div>

      {/* Toolbar & Filter */}
      <div className="toolbar-card">
        <div className="search-wrap">
          <span className="search-icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </span>
          <input
            type="text"
            className="search-input"
            placeholder="Search watches by label, movie name, or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-btn"
              onClick={() => setSearchQuery('')}
            >
              &times;
            </button>
          )}
        </div>
        <div className="stats-pill">
          {filteredWatches.length} {filteredWatches.length === 1 ? 'Watch' : 'Watches'}
        </div>
      </div>

      {/* Main List Area */}
      {loading ? (
        <div className="card loading-card">
          <div className="spinner"></div>
          <p className="text-muted">Loading registered watches...</p>
        </div>
      ) : error ? (
        <div className="card error-card">
          <div className="error-title">Unable to Load Watches</div>
          <p className="error-desc">{error}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fetchWatches()}
          >
            Retry
          </button>
        </div>
      ) : filteredWatches.length === 0 ? (
        <div className="card empty-card">
          <h3>No Watches Found</h3>
          <p className="text-muted">
            {searchQuery
              ? `No watches match "${searchQuery}".`
              : 'You have not set up any movie watches yet.'}
          </p>
          <Link to="/movies" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Browse Movies &amp; Add Watch
          </Link>
        </div>
      ) : (
        <div className="watches-list">
          {filteredWatches.map((w) => {
            const isDeleting = deletingId === w._id
            return (
              <div key={w._id} className="watch-card">
                <div className="watch-card-header">
                  <div className="watch-title-wrap">
                    <h3 className="watch-title">{w.label}</h3>
                    {w.movie_name && w.movie_name !== w.label && (
                      <span className="watch-movie-tag">{w.movie_name}</span>
                    )}
                  </div>
                  <div className="watch-header-actions">
                    <button
                      type="button"
                      className="btn btn-danger-outline btn-small"
                      disabled={isDeleting}
                      onClick={() => handleDelete(w._id, w.label)}
                    >
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>

                {/* Metadata Details */}
                <div className="watch-meta-grid">
                  <div className="meta-item">
                    <span className="meta-label">Monitoring Dates</span>
                    <span className="meta-value">
                      {w.start_date === w.end_date
                        ? formatDisplayDate(w.start_date)
                        : `${formatDisplayDate(w.start_date)} - ${formatDisplayDate(w.end_date)}`}
                    </span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-label">Format / Event</span>
                    <span className="meta-value font-mono">
                      {w.et_codes === '*' ? 'All Formats (*)' : w.et_codes} ({w.ref_event_code})
                    </span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-label">Interval</span>
                    <span className="meta-value">Every {w.interval_minutes} min</span>
                  </div>

                  <div className="meta-item">
                    <span className="meta-label">Notification Emails</span>
                    <span className="meta-value">
                      {w.emails && w.emails.length > 0 ? (
                        <span title={w.emails.join(', ')}>
                          {w.emails.length} recipient{w.emails.length === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="text-muted">None configured</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Discovered Dates Badges */}
                {w.available_dates && w.available_dates.length > 0 && (
                  <div className="available-dates-row">
                    <span className="dates-row-label">BookMyShow Active Dates:</span>
                    <div className="date-badges-wrap">
                      {w.available_dates.map((d8, i) => (
                        <span key={i} className="date-badge">
                          {formatDisplayDate(d8)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer with Theatres Trigger */}
                <div className="watch-card-footer">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => handleOpenVenues(w)}
                  >
                    View Seen Theatres ({w.known_venue_count || 0})
                  </button>
                  {w.last_checked_at && (
                    <span className="last-checked">
                      Last checked: {new Date(w.last_checked_at).toLocaleTimeString('en-IN')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Theatres Modal */}
      {modalWatch && (
        <div className="modal-backdrop" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Discovered Theatres</h3>
                <p className="modal-subtitle">{modalWatch.label}</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={handleCloseModal}
              >
                &times;
              </button>
            </div>

            <div className="modal-body">
              {loadingVenues ? (
                <div className="loading-card" style={{ padding: '2rem' }}>
                  <div className="spinner"></div>
                  <p className="text-muted">Fetching discovered venues...</p>
                </div>
              ) : venueError ? (
                <div className="alert alert-error">{venueError}</div>
              ) : venues.length === 0 ? (
                <div className="empty-card" style={{ padding: '2rem' }}>
                  <p className="text-muted">
                    No theatres recorded yet. The background poller will record venues as soon as tickets open.
                  </p>
                </div>
              ) : (
                <div className="venues-grouped-list">
                  {Object.entries(venuesByDate).map(([dateKey, vList]) => (
                    <div key={dateKey} className="venue-date-group">
                      <div className="venue-date-header">
                        Date: {formatDisplayDate(dateKey)} ({vList.length} {vList.length === 1 ? 'Theatre' : 'Theatres'})
                      </div>
                      <div className="venue-items">
                        {vList.map((v, idx) => (
                          <div key={idx} className="venue-item">
                            <span className="venue-name">{v.venue_name}</span>
                            <span className="venue-code">{v.venue_code}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseModal}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
