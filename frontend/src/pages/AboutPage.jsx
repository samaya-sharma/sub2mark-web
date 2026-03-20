function AboutPage() {
  return (
    <section className="panel about-panel">
      <h2>About</h2>
      <p>
        <b>sub2mark</b> tool turns Substack posts into clean, editable Markdown. You can review the output,
        make quick edits, and export everything as a tidy ZIP with images included.
      </p>
      <p>
        The goal is simple: keep your writing portable. Use the exported Markdown for backups,
        newsletters, or publishing workflows that live outside Substack.
      </p>
      <p>
        This is just the web version of the sub2mark tool. You can find it <a href="https://github.com/psugam/sub2mark" target="_blank" rel="noopener noreferrer"> <u>on Github</u></a>.
      </p>
    </section>
  )
}

export default AboutPage
