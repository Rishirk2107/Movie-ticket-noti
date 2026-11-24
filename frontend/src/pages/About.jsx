import React from 'react'
import { Link } from 'react-router-dom'

export default function About() {
  return (
    <div className="page-container about-page">
      {/* Hero Section */}
      <div className="about-hero">
        <div className="about-badge">BookMyShow Ticket Watcher &bull; Chennai</div>
        <h1 className="about-title">
          Never Miss Movie Ticket Openings in <span className="brand-accent">Chennai</span>
        </h1>
        <p className="about-lead">
          Automated BookMyShow showtimes tracker with native IST date resolution, format &amp; IMAX filtering,
          smart theatre deduplication, and instant email alerts.
        </p>

        <div className="about-cta-wrap">
          <Link to="/movies" className="btn btn-primary btn-large">
            Browse Movies &amp; Set Alerts &rarr;
          </Link>
          <Link to="/watches" className="btn btn-secondary btn-large">
            View Active Watches
          </Link>
        </div>
      </div>

      {/* 3-Step Visual Workflow */}
      <div className="workflow-section">
        <div className="section-header-centered">
          <span className="section-pill">How It Works</span>
          <h2 className="section-title-large">Set Up a Watch in 3 Simple Steps</h2>
          <p className="section-subtitle">
            No copying raw URLs. Select your formats and dates, and let the background poller do the work.
          </p>
        </div>

        <div className="workflow-cards-grid">
          {/* Step 1 */}
          <div className="workflow-card-step">
            <div className="step-glow-circle">1</div>
            <div className="step-card-content">
              <div className="step-card-tag">STEP 01</div>
              <h3 className="step-card-title">Pick a Movie</h3>
              <p className="step-card-desc">
                Browse trending Chennai releases or look up any title directly via its BookMyShow Event Code
                (e.g. <code>ET00451914</code>).
              </p>
            </div>
            <div className="step-card-connector">&rarr;</div>
          </div>

          {/* Step 2 */}
          <div className="workflow-card-step">
            <div className="step-glow-circle">2</div>
            <div className="step-card-content">
              <div className="step-card-tag">STEP 02</div>
              <h3 className="step-card-title">Choose Format &amp; Dates</h3>
              <p className="step-card-desc">
                Select your preferred format (IMAX 2D, 2D, or Select all), target dates within 14 days, and toggle
                the day-before (releaseDate &minus; 1) preview check.
              </p>
            </div>
            <div className="step-card-connector">&rarr;</div>
          </div>

          {/* Step 3 */}
          <div className="workflow-card-step">
            <div className="step-glow-circle">3</div>
            <div className="step-card-content">
              <div className="step-card-tag">STEP 03</div>
              <h3 className="step-card-title">Get Email Alerts</h3>
              <p className="step-card-desc">
                Receive instant email notifications with venue details the moment new screens and theatres open bookings.
              </p>
            </div>
          </div>
        </div>

        <div className="workflow-action-center">
          <Link to="/movies" className="btn btn-primary btn-large">
            Get Started &mdash; Browse Chennai Movies &rarr;
          </Link>
        </div>
      </div>

      {/* Feature Highlights Grid */}
      <div className="features-section">
        <div className="section-header-centered">
          <span className="section-pill">Built for Reliability</span>
          <h2 className="section-title-large">Engineered for Zero False Positives</h2>
        </div>

        <div className="about-features-grid">
          <div className="card feature-card">
            <div className="feature-kicker">AUTOMATION</div>
            <h3 className="feature-title">No Manual URL Pasting</h3>
            <p className="feature-text">
              Pick movies and formats with clean interactive chips. Never deal with brittle <code>/buytickets/...</code> URLs
              or date code path manipulations manually.
            </p>
          </div>

          <div className="card feature-card">
            <div className="feature-kicker">TIMEZONE</div>
            <h3 className="feature-title">Native IST (UTC+5:30) Date Logic</h3>
            <p className="feature-text">
              All date ranges, polling boundaries, and watch expirations calculate using local Indian Standard Time (UTC+5:30),
              preventing UTC midnight day-shift bugs.
            </p>
          </div>

          <div className="card feature-card">
            <div className="feature-kicker">PREVIEWS</div>
            <h3 className="feature-title">Early Screenings &amp; Previews</h3>
            <p className="feature-text">
              Automatically discovers earlier opening dates in the BMS showtimes date strip, with an optional
              <code>releaseDate &minus; 1</code> preview toggle for midnight or premiere shows.
            </p>
          </div>

          <div className="card feature-card">
            <div className="feature-kicker">ACCURACY</div>
            <h3 className="feature-title">Compound Deduplication</h3>
            <p className="feature-text">
              MongoDB compound unique index <code>(watch_id, date_code, venue_code)</code> ensures you receive alerts
              strictly when new theatres are added &mdash; zero repeated notifications.
            </p>
          </div>

          <div className="card feature-card">
            <div className="feature-kicker">DELIVERY</div>
            <h3 className="feature-title">Instant Email Notifications</h3>
            <p className="feature-text">
              Receive clean email alerts (with watch registration confirmation and theatre lists)
              sent directly to your configured alert email addresses.
            </p>
          </div>

          <div className="card feature-card">
            <div className="feature-kicker">MONITORING</div>
            <h3 className="feature-title">Live Poller Telemetry</h3>
            <p className="feature-text">
              Inspect active background polling cycles, API response statuses, and newly discovered venue counts
              in real time with the built-in activity console.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
