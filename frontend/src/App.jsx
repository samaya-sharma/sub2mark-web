import { useMemo, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage.jsx'
import AboutPage from './pages/AboutPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''

function App() {
  const [link, setLink] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [filename, setFilename] = useState('post.md')
  const [status, setStatus] = useState('idle')
  const [zipStatus, setZipStatus] = useState('idle')
  const [error, setError] = useState('')

  const wordCount = useMemo(() => {
    const trimmed = markdown.trim()
    if (!trimmed) return 0
    return trimmed.split(/\s+/).filter(Boolean).length
  }, [markdown])

  const handleConvert = async (event) => {
    event.preventDefault()
    setError('')

    if (!link.trim()) {
      setError('Paste a Substack link first.')
      return
    }

    try {
      setStatus('loading')
      const response = await fetch(`${API_BASE}/api/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ link })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Conversion failed.')
      }

      const data = await response.json()
      setMarkdown(data.markdown || '')
      setFilename(data.filename || 'post.md')
      setStatus('idle')
    } catch (err) {
      setStatus('idle')
      setError(err.message || 'Something went wrong.')
    }
  }

  const handleDownloadZip = async () => {
    setError('')

    if (!link.trim()) {
      setError('Paste a Substack link first.')
      return
    }

    try {
      setZipStatus('loading')
      const response = await fetch(`${API_BASE}/api/convert-zip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ link, markdown })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Zip download failed.')
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const zipName = match ? match[1] : 'post.zip'

      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = zipName
      anchor.click()
      URL.revokeObjectURL(url)
      setZipStatus('idle')
    } catch (err) {
      setZipStatus('idle')
      setError(err.message || 'Something went wrong.')
    }
  }

  const handleClear = () => {
    setLink('')
    setMarkdown('')
    setFilename('post.md')
    setStatus('idle')
    setZipStatus('idle')
    setError('')
  }

  return (
    <div className="app">
      <nav className="navbar">
        <div className="brand">
          <span className="brand-sub">sub</span>
          <span className="brand-num">2</span>
          <span className="brand-mark">mark</span>
        </div>
        <div className="nav-links">
          <NavLink className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} to="/">
            Home
          </NavLink>
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            to="/about"
          >
            About
          </NavLink>
        </div>
      </nav>

      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              link={link}
              markdown={markdown}
              filename={filename}
              status={status}
              zipStatus={zipStatus}
              error={error}
              wordCount={wordCount}
              onConvert={handleConvert}
              onDownloadZip={handleDownloadZip}
              onClear={handleClear}
              onLinkChange={(event) => setLink(event.target.value)}
              onMarkdownChange={(event) => setMarkdown(event.target.value)}
            />
          }
        />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <footer className="footer">
        <div>Substack to Markdown Converter <br/> Built for writers who want clean, portable drafts.</div>
      </footer>
    </div>
  )
}

export default App
