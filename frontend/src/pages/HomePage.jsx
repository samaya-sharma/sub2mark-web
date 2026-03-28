import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function HomePage({
  mode,
  link,
  markdown,
  outputLabel,
  statusLabel,
  status,
  zipStatus,
  error,
  wordCount,
  onConvert,
  onDownloadZip,
  onClear,
  onModeChange,
  onLinkChange,
  onMarkdownChange
}) {
  const isAllMode = mode === 'all'

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">Substack to Markdown</p>
          <h1>Convert, edit, and publish with confidence.</h1>
          <p className="subtitle">
            Paste a Substack link, edit the markdown, and download a ZIP with the post and images.
          </p>
        </div>
        <div className="hero-card">
          <div className="hero-card-row">
            <span>Output</span>
            <strong>{outputLabel}</strong>
          </div>
          <div className="hero-card-row">
            <span>Status</span>
            <strong>{statusLabel}</strong>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={onDownloadZip}
            disabled={!link.trim() || zipStatus === 'loading'}
          >
            {zipStatus === 'loading' ? 'Preparing ZIP...' : 'Download ZIP'}
          </button>
        </div>
      </header>

      <section className="input-panel">
        <div className="mode-toggle">
          <span className="mode-label">Conversion mode</span>
          <label className="mode-option">
            <input
              type="radio"
              name="convert-mode"
              value="single"
              checked={mode === 'single'}
              onChange={() => onModeChange('single')}
            />
            Single post
          </label>
          <label className="mode-option">
            <input
              type="radio"
              name="convert-mode"
              value="all"
              checked={mode === 'all'}
              onChange={() => onModeChange('all')}
            />
            All posts
          </label>
        </div>
        <form className="link-form" onSubmit={onConvert}>
          <label htmlFor="substack-link">Substack link</label>
          <div className="input-row">
            <input
              id="substack-link"
              type="url"
              placeholder={
                isAllMode
                  ? 'https://yourname.substack.com'
                  : 'https://yourname.substack.com/p/your-post'
              }
              value={link}
              onChange={onLinkChange}
            />
            <button type="submit" disabled={status === 'loading' || zipStatus === 'loading'}>
              {status === 'loading' || zipStatus === 'loading' ? 'Converting...' : 'Convert'}
            </button>
          </div>
          <div className="helper">
            {isAllMode ? (
              <>
              <ul>
                <li>
                   We fetch every post from the RSS feed and bundle each post folder (with images)
                into a single ZIP.
                </li>
                <li>
                  If there are many posts, the conversion process can take a while.
                </li>
              </ul>
               
              </>
            ) : (
              <>
              <ul>
                <li>We convert the Substack post into clean Markdown, preserving formatting and structure.</li>
                <li>Images are downloaded and linked properly in the markdown.</li>
                <li>You can edit the markdown in the built-in editor to fix any issues or make tweaks.</li>
                <li>Currently the images are not rendered here in preview but they'll work correctly in downloaded file. </li>
              </ul>
              </>
            )}
          </div>
          <button className="clear-button" type="button" onClick={onClear}>
            Clear input
          </button>
        </form>
        {error ? <div className="alert">{error}</div> : null}
      </section>

      {isAllMode ? null : (
        <section className="main-grid">
          <div className="panel editor-panel">
            <div className="panel-header">
              <h2>Editor</h2>
              <span className="panel-meta">{wordCount} words</span>
            </div>
            <textarea
              value={markdown}
              onChange={onMarkdownChange}
              placeholder="Your markdown will show up here. Edit freely."
            />
          </div>

          <div className="panel preview-panel">
            <div className="panel-header">
              <h2>Preview</h2>
              <span className="panel-meta">Live render</span>
            </div>
            <div className="preview-content">
              {markdown ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
              ) : (
                <p className="empty-state">Paste a Substack link to see the rendered markdown.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  )
}

export default HomePage
