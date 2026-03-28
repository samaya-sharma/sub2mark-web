import { useMemo, useState } from 'react'

const SUB2MARK_LIB_EXAMPLE = `import { convertSubstackToMarkdown, convertSubstackToZip } from 'sub2mark-lib';
// Note: The link used here does not exist. Use a real one.
const result = await convertSubstackToMarkdown('https://example.substack.com/p/my-post', {
  outputDir: './output',
  mdFilename: 'post.md'
});

console.log(result.postDir);

const zipResult = await convertSubstackToZip('https://example.substack.com/p/my-post', {
  outputDir: './output',
  zipName: 'my-post.zip'
});

console.log(zipResult.zipPath);`

const SUB2MARK_SITE_EXAMPLE = `import { buildSubstackSite } from 'sub2mark-site';

await buildSubstackSite('https://example.substack.com', {
  outputDir: './site',
  limit: 50,
  update: false
});`

const TOKEN_PATTERN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")|(\b\d+(?:\.\d+)?\b)|(\b(?:import|from|const|let|await|return|export|async|function|class|new|if|else)\b)|(\b(?:true|false|null|undefined)\b)|(\b[A-Za-z_][\w]*)(?=\()|([{}()[\].,;])|([=><!:+\-*/%]+)/g

const escapeHtml = (value) =>
  value.replace(/[&<>]/g, (char) => {
    if (char === '&') return '&amp;'
    if (char === '<') return '&lt;'
    return '&gt;'
  })

const highlightCode = (code) => {
  const escaped = escapeHtml(code)

  return escaped.replace(
    TOKEN_PATTERN,
    (match, comment, string, number, keyword, boolean, func, punctuation, operator) => {
      if (comment) return `<span class="token comment">${match}</span>`
      if (string) return `<span class="token string">${match}</span>`
      if (number) return `<span class="token number">${match}</span>`
      if (keyword) return `<span class="token keyword">${match}</span>`
      if (boolean) return `<span class="token boolean">${match}</span>`
      if (func) return `<span class="token function">${match}</span>`
      if (punctuation) return `<span class="token punctuation">${match}</span>`
      if (operator) return `<span class="token operator">${match}</span>`
      return match
    }
  )
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false)
  const highlighted = useMemo(() => highlightCode(code), [code])

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = code
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (error) {
      setCopied(false)
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <button className="code-block-copy" type="button" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}

function CodePage() {
  return (
    <section className="panel about-panel">
      <h2>Code</h2>

      <p>
        This is just a basic web interface for the sub2mark-lib library. You can do all of this yourself locally if you want. You can find it sub2mark-lib <a href="https://www.npmjs.com/package/sub2mark-lib" target="_blank"><u>here</u></a>
        <br/>
        <br/>
        Use sub2mark-lib to convert individual substack posts. 
      </p>
      <CodeBlock code={SUB2MARK_LIB_EXAMPLE} />
      <p>
        You can also use the sub2mark-site library to convert your entire substack catalogue to a very basic static site that can be hosted anywhere. The UI is very basic but it gets the job done. Like sub2mark-lib, this one also works only for free (i.e non-paywalled posts). You can find it <a href="https://www.npmjs.com/package/sub2mark-site" target="_blank"><u>here</u></a>
      </p>
      <CodeBlock code={SUB2MARK_SITE_EXAMPLE} />
    </section>
  )
}

export default CodePage
