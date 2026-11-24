import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'

const LANGUAGE_FILTERS = ['All', 'Tamil', 'English', 'Hindi', 'Telugu']

function formatGenres(genreStr) {
  if (!genreStr) return []
  return genreStr
    .split(/[|,/]+/)
    .map((g) => g.trim())
    .filter(Boolean)
}

function formatLanguage(langStr) {
  if (!langStr) return ''
  return langStr.charAt(0).toUpperCase() + langStr.slice(1).toLowerCase()
}

export default function Home() {
  const navigate = useNavigate()
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedLanguage, setSelectedLanguage] = useState('All')
  const [manualCode, setManualCode] = useState('')
  const [manualError, setManualError] = useState('')

  const fetchMovies = (signal) => {
    setLoading(true)
    setError(null)
    api
      .getMovies(signal)
      .then((data) => {
        setMovies(data.movies || [])
        setLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message || 'Failed to load movies from BookMyShow')
        setLoading(false)
      })
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchMovies(controller.signal)
    return () => controller.abort()
  }, [])

  const handleSelectMovie = (movie) => {
    navigate(`/configure?eventCode=${encodeURIComponent(movie.event_code)}`, {
      state: { movie },
    })
  }

  const handleManualLookup = (e) => {
    e.preventDefault()
    const trimmed = manualCode.trim().toUpperCase()
    if (!trimmed) return
    if (!/^ET\d{8}$/i.test(trimmed)) {
      setManualError('Event code must be in format ET00000000 (e.g. ET00451914)')
      return
    }
    setManualError('')
    navigate(`/configure?eventCode=${encodeURIComponent(trimmed)}`)
  }

  const filteredMovies = movies.filter((m) => {
    // Language Filter
    if (selectedLanguage !== 'All') {
      const movieLang = (m.language || '').toLowerCase()
      if (!movieLang.includes(selectedLanguage.toLowerCase())) {
        return false
      }
    }

    // Text Query Search
    const q = searchQuery.toLowerCase().trim()
    if (!q) return true
    return (
      (m.title && m.title.toLowerCase().includes(q)) ||
      (m.language && m.language.toLowerCase().includes(q)) ||
      (m.genre && m.genre.toLowerCase().includes(q)) ||
      (m.event_code && m.event_code.toLowerCase().includes(q))
    )
  })

  return (
    <div className="page-container">
      {/* Header Banner */}
      <div className="hero-banner">
        <div>
          <div className="hero-badge">BookMyShow Chennai &bull; Live Discovery</div>
          <h1 className="page-title">Browse Movies in Chennai</h1>
          <p className="page-subtitle">
            Select a movie to monitor ticket openings, early preview shows, and IMAX formats in real time.
          </p>
        </div>
        <div className="stats-pill">
          {filteredMovies.length} {filteredMovies.length === 1 ? 'Movie' : 'Movies'}
        </div>
      </div>

      {/* Search & Manual Event Code Bar */}
      <div className="toolbar-card">
        <div className="toolbar-top">
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
              placeholder="Search by title, language, or genre..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                &times;
              </button>
            )}
          </div>

          <form onSubmit={handleManualLookup} className="manual-lookup-form">
            <input
              type="text"
              className="manual-input"
              placeholder="Event Code (e.g. ET00451914)"
              value={manualCode}
              onChange={(e) => {
                setManualCode(e.target.value)
                if (manualError) setManualError('')
              }}
            />
            <button type="submit" className="btn btn-secondary">
              Look up
            </button>
          </form>
        </div>

        {/* Quick Language Filter Pills */}
        <div className="language-pills-row">
          <span className="filter-label">Language:</span>
          <div className="language-pills">
            {LANGUAGE_FILTERS.map((lang) => (
              <button
                key={lang}
                type="button"
                className={`lang-pill ${selectedLanguage === lang ? 'active' : ''}`}
                onClick={() => setSelectedLanguage(lang)}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
      </div>

      {manualError && <div className="alert alert-error">{manualError}</div>}

      {/* Main Content Area */}
      {loading ? (
        <div className="card loading-card">
          <div className="spinner"></div>
          <p className="text-muted">Loading movies from BookMyShow Chennai...</p>
        </div>
      ) : error ? (
        <div className="card error-card">
          <div className="error-title">Unable to Load Movies</div>
          <p className="error-desc">{error}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fetchMovies()}
          >
            Retry Loading
          </button>
        </div>
      ) : filteredMovies.length === 0 ? (
        <div className="card empty-card">
          <h3>No Movies Found</h3>
          <p className="text-muted">
            {searchQuery || selectedLanguage !== 'All'
              ? `No movies match your current search and language filters. Try clearing filters or entering an Event Code above.`
              : 'No movies are currently listed. You can enter an Event Code directly above.'}
          </p>
          {(searchQuery || selectedLanguage !== 'All') && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: '1rem' }}
              onClick={() => {
                setSearchQuery('')
                setSelectedLanguage('All')
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="movies-grid">
          {filteredMovies.map((movie) => {
            const genres = formatGenres(movie.genre)
            const lang = formatLanguage(movie.language)
            return (
              <div
                key={movie.event_code}
                className="movie-card"
                onClick={() => handleSelectMovie(movie)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => e.key === 'Enter' && handleSelectMovie(movie)}
              >
                <div className="poster-wrap">
                  {movie.poster ? (
                    <img
                      src={movie.poster}
                      alt={movie.title}
                      className="movie-poster"
                      loading="lazy"
                      onError={(e) => {
                        e.target.style.display = 'none'
                        const fallback = e.target.parentElement.querySelector('.poster-fallback')
                        if (fallback) fallback.style.display = 'flex'
                      }}
                    />
                  ) : null}
                  <div
                    className="poster-fallback"
                    style={{ display: movie.poster ? 'none' : 'flex' }}
                  >
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                      <line x1="7" y1="2" x2="7" y2="22"></line>
                      <line x1="17" y1="2" x2="17" y2="22"></line>
                      <line x1="2" y1="12" x2="22" y2="12"></line>
                      <line x1="2" y1="7" x2="7" y2="7"></line>
                      <line x1="2" y1="17" x2="7" y2="17"></line>
                      <line x1="17" y1="17" x2="22" y2="17"></line>
                      <line x1="17" y1="7" x2="22" y2="7"></line>
                    </svg>
                  </div>

                  {/* Subtle top-right event code badge */}
                  <span className="poster-code-badge" title="BookMyShow Event Code">
                    {movie.event_code}
                  </span>

                  <div className="poster-overlay">
                    <span className="overlay-badge">Configure Watch &rarr;</span>
                  </div>
                </div>

                <div className="movie-info">
                  <h3 className="movie-title" title={movie.title}>
                    {movie.title}
                  </h3>

                  <div className="movie-meta">
                    {lang && <span className="meta-tag meta-tag-lang">{lang}</span>}
                    {genres.slice(0, 2).map((g, idx) => (
                      <span key={idx} className="meta-tag meta-tag-genre" title={g}>
                        {g}
                      </span>
                    ))}
                    {genres.length > 2 && (
                      <span className="meta-tag meta-tag-more" title={genres.slice(2).join(', ')}>
                        +{genres.length - 2}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
