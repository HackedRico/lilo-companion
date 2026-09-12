// Lilo's in-page agent. Runs in the page's own world so it can read the
// editor's model rather than the screen, fetch the problem through the site's
// own session, and see outcomes on the site's own network calls. Installs
// once, polls with change detection, and never writes to the page beyond a
// mark on a line that the next edit clears.
;(() => {
  if (window.__lilo) return
  window.__lilo = { version: 1 }

  const POLL_MS = 1000
  const state = { slug: null, code: null, language: null, inFront: null, marks: null }

  const post = (event) => window.postMessage({ lilo: 'event', event: { at: Date.now(), ...event } }, location.origin)

  const slugOf = () => (location.pathname.match(/^\/problems\/([^/]+)/) || [])[1] || null

  const editor = () => {
    const monaco = window.monaco
    if (!monaco || !monaco.editor || !monaco.editor.getEditors) return null
    return monaco.editor.getEditors()[0] || null
  }

  // The editor's model is the code, whatever the page draws around it.
  const model = () => {
    const live = editor()
    if (live && live.getModel) return live.getModel()
    const monaco = window.monaco
    const models = monaco && monaco.editor && monaco.editor.getModels ? monaco.editor.getModels() : []
    return models.slice().sort((a, b) => b.getValueLength() - a.getValueLength())[0] || null
  }

  const textOf = (html) => {
    const box = document.createElement('div')
    box.innerHTML = html
    return (box.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  async function problem(slug) {
    try {
      const response = await fetch('/graphql', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationName: 'questionData',
          variables: { titleSlug: slug },
          query: 'query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { title difficulty content } }'
        })
      })
      const question = (await response.json()).data.question
      return { slug, title: question.title, difficulty: question.difficulty || '', statement: textOf(question.content || '').slice(0, 8000) }
    } catch {
      return { slug, title: slug.replace(/-/g, ' '), difficulty: '', statement: '' }
    }
  }

  async function tick() {
    const slug = slugOf()
    if (slug !== state.slug) {
      state.slug = slug
      state.code = null
      state.language = null
      if (slug) post({ kind: 'opened', problem: await problem(slug) })
      else post({ kind: 'closed' })
    }
    const live = model()
    if (slug && live) {
      const code = live.getValue()
      const language = live.getLanguageId ? live.getLanguageId() : ''
      if (code !== state.code || language !== state.language) {
        state.code = code
        state.language = language
        post({ kind: 'changed', code: code.slice(0, 20000), language })
        clearMarks()
      }
    }
    const inFront = document.visibilityState === 'visible' && document.hasFocus()
    if (inFront !== state.inFront) {
      state.inFront = inFront
      post({ kind: 'attention', inFront })
    }
  }

  // A run or a submit is a POST, then the page polls a check URL until it settles.
  const verdictOf = (message) => {
    if (/accepted/i.test(message)) return 'accepted'
    if (/wrong answer/i.test(message)) return 'wrong_answer'
    if (/time limit/i.test(message)) return 'time_limit'
    if (/runtime error/i.test(message)) return 'runtime_error'
    if (/compile error/i.test(message)) return 'compile_error'
    return 'other'
  }

  const asText = (value) => {
    if (value === undefined || value === null || value === '') return undefined
    return String(Array.isArray(value) ? value.join('\n') : value).slice(0, 2000)
  }

  function outcomeOf(data) {
    const outcome = {
      verdict: verdictOf(String(data.status_msg || '')),
      detail: String(data.full_compile_error || data.full_runtime_error || data.runtime_error || data.compile_error || '').slice(0, 2000)
    }
    const input = asText(data.input_formatted || data.input || data.last_testcase)
    const expected = asText(data.expected_output || data.expected_code_answer)
    const output = asText(data.code_output || data.code_answer)
    if (input) outcome.input = input
    if (expected) outcome.expected = expected
    if (output) outcome.output = output
    return outcome
  }

  const originalFetch = window.fetch
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url ? input.url : ''
    const response = await originalFetch.apply(this, arguments)
    try {
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
      if (method === 'POST' && /\/(submit|interpret_solution)\/?(\?|$)/.test(url)) post({ kind: 'pending' })
      if (/\/submissions\/detail\/[^/]+\/check\/?(\?|$)/.test(url)) {
        const data = await response.clone().json()
        if (data && data.state === 'SUCCESS') post({ kind: 'outcome', outcome: outcomeOf(data) })
      }
    } catch {
      // A response that is not what the page expected is not ours to judge.
    }
    return response
  }

  // The one channel back: a mark on lines, marked as the companion's, gone on the next edit.
  function mark(lines) {
    const live = editor()
    if (!live || !live.createDecorationsCollection || !window.monaco.Range) return
    clearMarks()
    state.marks = live.createDecorationsCollection(
      lines.map((line) => ({
        range: new window.monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: 'lilo-mark' }
      }))
    )
  }

  function clearMarks() {
    if (!state.marks) return
    state.marks.clear()
    state.marks = null
  }

  window.addEventListener('message', (message) => {
    if (message.source !== window || !message.data || message.data.lilo !== 'mark') return
    mark(Array.isArray(message.data.lines) ? message.data.lines.filter((n) => Number.isInteger(n)) : [])
  })

  const style = document.createElement('style')
  style.textContent = '.lilo-mark { background: rgba(255, 196, 0, 0.16); }'
  document.head.appendChild(style)

  document.addEventListener('visibilitychange', () => void tick())
  window.addEventListener('focus', () => void tick())
  window.addEventListener('blur', () => void tick())
  setInterval(() => void tick(), POLL_MS)
  void tick()
})()
