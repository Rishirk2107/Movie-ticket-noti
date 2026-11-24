import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'

export default function Logs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isPaused, setIsPaused] = useState(false)
  const [levelFilter, setLevelFilter] = useState('ALL')
  const [lastRefreshed, setLastRefreshed] = useState(null)

  // Track isPaused in a ref for the polling interval
  const isPausedRef = useRef(isPaused)
  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  const fetchLogs = (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    api
      .getLogs(50)
      .then((data) => {
        setLogs(data.logs || [])
        setError(null)
        setLastRefreshed(new Date())
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Failed to fetch logs.')
        setLoading(false)
      })
  }

  // Initial load + background polling interval (every 3 seconds)
  useEffect(() => {
    fetchLogs(true)

    const timer = setInterval(() => {
      if (!isPausedRef.current) {
        fetchLogs(false)
      }
    }, 3000)

    return () => clearInterval(timer)
  }, [])

  const filteredLogs = logs.filter((log) => {
    if (levelFilter === 'ALL') return true
    return log.level === levelFilter
  })

  return (
    <div className="page-container">
      {/* Header Banner */}
      <div className="hero-banner">
        <div>
          <h1 className="page-title">Live Activity Logs</h1>
          <p className="page-subtitle">
            Real-time feed from the BookMyShow background ticket poller and API fetchers.
          </p>
        </div>
        <div className="banner-actions">
          <Link to="/movies" className="btn btn-secondary">
            &larr; Movies
          </Link>
          <Link to="/watches" className="btn btn-secondary">
            Active Watches &rarr;
          </Link>
        </div>
      </div>

      {/* Controls Toolbar */}
      <div className="toolbar-card">
        <div className="log-controls-left">
          <button
            type="button"
            className={`btn btn-small ${isPaused ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setIsPaused((prev) => !prev)}
          >
            {isPaused ? 'Resume Polling' : 'Pause Polling'}
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => fetchLogs(false)}
          >
            Refresh Now
          </button>

          <span className="live-status-indicator">
            <span
              className="status-dot"
              style={{ backgroundColor: isPaused ? '#f59e0b' : '#10b981' }}
            ></span>
            {isPaused ? 'Polling Paused' : 'Live Auto-Refreshing (3s)'}
          </span>
        </div>

        {/* Level Filter Chips */}
        <div className="filter-chips">
          {['ALL', 'INFO', 'SUCCESS', 'WARN', 'ERROR'].map((lvl) => (
            <button
              key={lvl}
              type="button"
              className={`filter-chip ${levelFilter === lvl ? 'active' : ''}`}
              onClick={() => setLevelFilter(lvl)}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal Console Box */}
      <div className="card terminal-card">
        <div className="terminal-header">
          <div className="terminal-dots">
            <span className="dot dot-red"></span>
            <span className="dot dot-yellow"></span>
            <span className="dot dot-green"></span>
          </div>
          <span className="terminal-title">Console Output (Last 50 Entries)</span>
          {lastRefreshed && (
            <span className="terminal-ts">
              Updated: {lastRefreshed.toLocaleTimeString('en-IN')}
            </span>
          )}
        </div>

        <div className="terminal-body">
          {loading && logs.length === 0 ? (
            <div className="terminal-msg">Connecting to live log stream...</div>
          ) : error && logs.length === 0 ? (
            <div className="terminal-msg error">{error}</div>
          ) : filteredLogs.length === 0 ? (
            <div className="terminal-msg">
              No logs matching level "{levelFilter}".
            </div>
          ) : (
            filteredLogs.map((entry, idx) => {
              const levelClass = `lvl-${(entry.level || 'INFO').toLowerCase()}`
              return (
                <div key={idx} className="terminal-line">
                  <span className="line-ts">[{entry.timestamp}]</span>
                  <span className={`line-lvl ${levelClass}`}>{entry.level}</span>
                  <span className="line-msg">{entry.message}</span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
