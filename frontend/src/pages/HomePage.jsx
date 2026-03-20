import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function HomePage({
  link,
  markdown,
  filename,
  status,
  zipStatus,
  error,
  wordCount,
  onConvert,
  onDownloadZip,
  onClear,
  onLinkChange,
  onMarkdownChange
}) {
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
            <strong>{filename}</strong>
          </div>
          <div className="hero-card-row">
            <span>Status</span>
            <strong>{status === 'loading' ? 'Converting' : markdown ? 'Ready' : 'Waiting'}</strong>
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
        <form className="link-form" onSubmit={onConvert}>
          <label htmlFor="substack-link">Substack link</label>
          <div className="input-row">
            <input
              id="substack-link"
              type="url"
              placeholder="https://yourname.substack.com/p/your-post"
              value={link}
              onChange={onLinkChange}
            />
            <button type="submit" disabled={status === 'loading'}>
              {status === 'loading' ? 'Converting...' : 'Convert'}
            </button>
          </div>
          <p className="helper">
            We download images into an `images/` folder and bundle everything as a ZIP.
            <br />
           <br/>
           Any changes made in the editor will be reflected in the zip output. So, feel free to edit and change anything according to the preview.
           <br/>
           <br/>
           The images are currently not rendered properly in the preview. They work perfectly well in the downloaded markdown file. 
          </p>
          <button className="clear-button" type="button" onClick={onClear}>
            Clear input
          </button>
        </form>
        {error ? <div className="alert">{error}</div> : null}
      </section>

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
    </>
  )
}

export default HomePage
