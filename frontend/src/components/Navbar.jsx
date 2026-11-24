import React from 'react'
import { NavLink } from 'react-router-dom'

export default function Navbar() {
  return (
    <header className="navbar">
      <div className="navbar-container">
        <NavLink to="/" className="navbar-brand">
          <div className="brand-badge">BMS</div>
          <span className="brand-text">
            Ticket <span className="brand-accent">Watcher</span>
          </span>
        </NavLink>

        <nav className="navbar-links">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            Movies
          </NavLink>
          <NavLink
            to="/watches"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            Active Watches
          </NavLink>
          <NavLink
            to="/logs"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            Activity Logs
          </NavLink>
        </nav>
      </div>
    </header>
  )
}
