import { useMemo, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage.jsx'
import AboutPage from './pages/AboutPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import './App.css'

const API_BASE = (import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '')

function App() {
  const [mode, setMode] = useState('single')
  const [link, setLink] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [filename, setFilename] = useState('post.md')
  const [bulkZipName, setBulkZipName] = useState('')
  const [status, setStatus] = useState('idle')
  const [zipStatus, setZipStatus] = useState('idle')
  const [error, setError] = useState('')
  const [bulkProgress, setBulkProgress] = useState({
    status: 'idle',
    converted: 0,
    total: 0,
    jobId: '',
    zipName: ''
  })

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

  const resetBulkProgress = () => {
    setBulkProgress({
      status: 'idle',
      converted: 0,
      total: 0,
      jobId: '',
      zipName: ''
    })
  }

  const pollBulkJob = async (jobId) => {
    while (true) {
      const response = await fetch(`${API_BASE}/api/convert-all/status/${jobId}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load conversion status.')
      }

      const data = await response.json()
      setBulkProgress((prev) => ({
        ...prev,
        status: data.status,
        converted: data.converted,
        total: data.total,
        zipName: data.zipName || prev.zipName,
        jobId
      }))

      if (data.status === 'done') {
        return data
      }

      if (data.status === 'error') {
        throw new Error(data.error || 'Conversion failed.')
      }

      await new Promise((resolve) => setTimeout(resolve, 800))
    }
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
      if (mode === 'all') {
        resetBulkProgress()
        const startResponse = await fetch(`${API_BASE}/api/convert-all/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ link })
        })

        if (!startResponse.ok) {
          const data = await startResponse.json().catch(() => ({}))
          throw new Error(data.error || 'Conversion failed.')
        }

        const startData = await startResponse.json()
        setBulkProgress({
          status: 'running',
          converted: 0,
          total: startData.total || 0,
          jobId: startData.jobId,
          zipName: startData.zipName || ''
        })

        await pollBulkJob(startData.jobId)

        const downloadResponse = await fetch(
          `${API_BASE}/api/convert-all/download/${startData.jobId}`
        )

        if (!downloadResponse.ok) {
          const data = await downloadResponse.json().catch(() => ({}))
          throw new Error(data.error || 'Zip download failed.')
        }

        const blob = await downloadResponse.blob()
        const disposition = downloadResponse.headers.get('content-disposition') || ''
        const match = disposition.match(/filename="([^"]+)"/)
        const fallbackName = startData.zipName || 'substack.zip'
        const zipName = match ? match[1] : fallbackName

        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = zipName
        anchor.click()
        URL.revokeObjectURL(url)

        setBulkZipName(zipName)
        setZipStatus('idle')
        setBulkProgress((prev) => ({
          ...prev,
          status: 'done',
          converted: prev.total
        }))
        return
      }

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
      setZipStatus('idle')
    } catch (err) {
      setZipStatus('idle')
      if (mode === 'all') {
        resetBulkProgress()
      }
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
    resetBulkProgress()
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
            to="/about"
          >
            About
          </NavLink>
          {/* <NavLink
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            to="/about"
          >
            About
          </NavLink> */}
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
              bulkProgress={bulkProgress}
              onConvert={handleConvert}
              onDownloadZip={handleDownloadZip}
              onClear={handleClear}
              onModeChange={(value) => {
                setMode(value)
                resetBulkProgress()
                setError('')
              }}
              onLinkChange={(event) => {
                setLink(event.target.value)
                if (mode === 'all') {
                  setBulkZipName('')
                  resetBulkProgress()
                }
              }}
              onMarkdownChange={(event) => setMarkdown(event.target.value)}
            />
          }
        />
        <Route path="/about" element={<AboutPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <footer className="footer">
        <div> <br/> <br/> Substack to Markdown Converter</div>
      </footer>
    </div>
  )
}

export default App
