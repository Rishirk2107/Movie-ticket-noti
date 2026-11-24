import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import About from './pages/About'
import Home from './pages/Home'
import ConfigureWatch from './pages/ConfigureWatch'
import Watches from './pages/Watches'
import Logs from './pages/Logs'

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <Navbar />
        <main className="main-content">
          <Routes>
            {/* / is the About & Overview page */}
            <Route path="/" element={<About />} />
            {/* /movies is the movie discovery & picker catalog */}
            <Route path="/movies" element={<Home />} />
            <Route path="/configure" element={<ConfigureWatch />} />
            <Route path="/watches" element={<Watches />} />
            <Route path="/logs" element={<Logs />} />
            {/* Fallback to / */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
