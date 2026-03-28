import { useMemo, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage.jsx'
import CodePage from './pages/CodePage.jsx'
import AboutPage from './pages/AboutPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''

function App() {
  const [mode, setMode] = useState('single')
  const [link, setLink] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [filename, setFilename] = useState('post.md')
  const [bulkZipName, setBulkZipName] = useState('')
  const [status, setStatus] = useState('idle')
  const [zipStatus, setZipStatus] = useState('idle')
  const [error, setError] = useState('')

  const wordCount = useMemo(() => {
    const trimmed = markdown.trim()
    if (!trimmed) return 0
    return trimmed.split(/\s+/).filter(Boolean).length
  }, [markdown])

  const normalizeUrl = (value) => {
    const trimmed = (value || '').trim()
    if (!trimmed) return ''
    return trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`
  }

  const isPostUrl = (value) => {
    try {
      const url = new URL(normalizeUrl(value))
      return /\/p\/[^/?#]+/i.test(url.pathname)
    } catch {
      return false
    }
  }

  const validateLink = () => {
    if (!link.trim()) {
      return 'Paste a Substack link first.'
    }
    if (mode === 'single' && !isPostUrl(link)) {
      return 'Please use a single post URL (it should include /p/).'
    }
    if (mode === 'all' && isPostUrl(link)) {
      return 'Please use the main Substack URL (not a single post link).'
    }
    return ''
  }

  const handleConvert = async (event) => {
    event.preventDefault()
    setError('')

    const validationError = validateLink()
    if (validationError) {
      setError(validationError)
      return
    }

    if (mode === 'all') {
      await handleDownloadZip()
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

    const validationError = validateLink()
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setZipStatus('loading')
      const endpoint = mode === 'all' ? '/api/convert-all' : '/api/convert-zip'
      const payload = mode === 'all' ? { link } : { link, markdown }
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Zip download failed.')
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const fallbackName = mode === 'all' ? 'substack.zip' : 'post.zip'
      const zipName = match ? match[1] : fallbackName

      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = zipName
      anchor.click()
      URL.revokeObjectURL(url)
      if (mode === 'all') {
        setBulkZipName(zipName)
      }
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
    setBulkZipName('')
    setStatus('idle')
    setZipStatus('idle')
    setError('')
  }

  const isAllMode = mode === 'all'
  const outputLabel = isAllMode ? bulkZipName || 'substack.zip' : filename
  const statusLabel = isAllMode
    ? zipStatus === 'loading'
      ? 'Converting'
      : bulkZipName
        ? 'Ready'
        : 'Waiting'
    : status === 'loading'
      ? 'Converting'
      : markdown
        ? 'Ready'
        : 'Waiting'

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
            to="/code"
          >
            Code
          </NavLink>
          <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            to="/about"
          >
            About
          </NavLink>
          {/* <a
            className="nav-link"
            href="https://github.com/psugam/sub2mark-lib"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a> */}
        </div>
      </nav>

      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              mode={mode}
              link={link}
              markdown={markdown}
              outputLabel={outputLabel}
              statusLabel={statusLabel}
              status={status}
              zipStatus={zipStatus}
              error={error}
              wordCount={wordCount}
              onConvert={handleConvert}
              onDownloadZip={handleDownloadZip}
              onClear={handleClear}
              onModeChange={(value) => {
                setMode(value)
                setError('')
              }}
              onLinkChange={(event) => {
                setLink(event.target.value)
                if (mode === 'all') {
                  setBulkZipName('')
                }
              }}
              onMarkdownChange={(event) => setMarkdown(event.target.value)}
            />
          }
        />
        <Route path="/code" element={<CodePage />} />
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
