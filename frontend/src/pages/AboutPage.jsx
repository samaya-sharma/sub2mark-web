function AboutPage() {
  return (
    <section className="panel about-panel">
      <h2>About</h2>
      <p>
        <b>sub2mark</b> tool turns Substack posts into clean, editable Markdown. You can review the output,
        make quick edits, and export everything as a tidy ZIP with images included.
      </p>
      <p>
        Only free (i.e non-paywalled) Substack posts are supported. For best results, use the post's main URL (not the AMP version). The tool is designed to handle a wide range of Substack content, but some complex formatting may not convert perfectly. Always review the output before publishing or sharing.
      </p>
      <p>
        This is just the web version of the sub2mark tool. You can find it <a href="https://github.com/samaya-sharma/sub2mark-lib" target="_blank" rel="noopener noreferrer"> <u>on Github</u></a>.
      </p>
    </section>
  )
}

export default AboutPage
