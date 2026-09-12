// Lilo's in-page agent. Runs in the page's own world so it can read the
// editor's model rather than the screen, fetch the problem through the site's
// own session, and see outcomes on the site's own network calls. Installs
// once, polls with change detection, and never writes to the page beyond a
// mark on a line that the next edit clears.
;(() => {
  if (window.__lilo) return
  window.__lilo = { version: 1 }

  const POLL_MS = 1000
  /** An edit is reported once the code has sat still this long, not on every keystroke. */
  const SETTLE_MS = 1500
  const state = { slug: null, code: null, language: null, inFront: null, marks: null, draft: null, problem: null }

  const post = (event) => window.postMessage({ lilo: 'event', event: { at: Date.now(), ...event } }, location.origin)

  const slugOf = () => (location.pathname.match(/^\/problems\/([^/]+)/) || [])[1] || null

  const languageOf = (model) => (model && model.getLanguageId ? model.getLanguageId() : '')

  // The page has more than one Monaco: the test case box and the console are
  // plain text. The code editor is the one with a language, and the biggest
  // of those when several have one.
  const isCode = (model) => {
    const language = languageOf(model)
    return language !== '' && language !== 'plaintext'
  }

  const editor = () => {
    const monaco = window.monaco
    if (!monaco || !monaco.editor || !monaco.editor.getEditors) return null
    const editors = monaco.editor.getEditors().filter((one) => one.getModel && isCode(one.getModel()))
    return editors.sort((a, b) => b.getModel().getValueLength() - a.getModel().getValueLength())[0] || null
  }

  const model = () => {
    const live = editor()
    if (live) return live.getModel()
    const monaco = window.monaco
    const models = monaco && monaco.editor && monaco.editor.getModels ? monaco.editor.getModels() : []
    return models.filter(isCode).sort((a, b) => b.getValueLength() - a.getValueLength())[0] || null
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
        // The poll waits on this, so it is not allowed to wait forever. The
        // title falls back to the slug, which is enough to say what is open.
        signal: AbortSignal.timeout(6000),
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

  // The problem is fetched before `opened` goes out, and the poll does not
  // stop while that is in the air. Without this guard a later tick posts the
  // code first, and `opened` lands behind it and wipes what it just reported.
  let ticking = false

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      await step()
    } finally {
      ticking = false
    }
  }

  /**
   * Everything this tab has, said again. `opened` goes out when the tab's own
   * slug changes and nothing else sends it, so an app that started after the
   * tab did would have no problem open however long the student worked here,
   * and every hint would answer "nothing open on LeetCode". The app asks for
   * this down each fresh connection, which is the whole recovery.
   */
  async function announce() {
    const slug = slugOf()
    state.slug = slug
    if (!slug) {
      post({ kind: 'closed' })
      return
    }
    // Already in hand from the first announcement, so this one usually costs no fetch.
    if (!state.problem || state.problem.slug !== slug) state.problem = await problem(slug)
    post({ kind: 'opened', problem: state.problem })
    const live = model()
    if (live) {
      state.code = live.getValue()
      state.language = languageOf(live)
      state.draft = null
      post({ kind: 'changed', code: state.code.slice(0, 20000), language: state.language })
    }
    state.inFront = document.visibilityState === 'visible' && document.hasFocus()
    post({ kind: 'attention', inFront: state.inFront })
  }

  // A piled-up tick is dropped because the next one is a second away. This is
  // the recovery, so it waits for whatever is in the air and then goes.
  async function sayItAgain() {
    while (ticking) await new Promise((resolve) => setTimeout(resolve, 100))
    ticking = true
    try {
      await announce()
    } finally {
      ticking = false
    }
  }

  async function step() {
    const slug = slugOf()
    if (slug !== state.slug) {
      state.slug = slug
      state.code = null
      state.language = null
      state.problem = slug ? await problem(slug) : null
      if (state.problem) post({ kind: 'opened', problem: state.problem })
      else post({ kind: 'closed' })
    }
    const live = model()
    if (slug && live) {
      const code = live.getValue()
      const language = languageOf(live)
      if (state.code === null) {
        // The first look at a problem has nothing to debounce against: the wait
        // is for a student to stop typing, and nobody has typed yet. Monaco is
        // slow enough to restore what was saved that adding the wait on top put
        // the first report four seconds after the tab opened, by which time the
        // companion had already said there was nothing written.
        state.code = code
        state.language = language
        state.draft = null
        post({ kind: 'changed', code: code.slice(0, 20000), language })
      } else if (code === state.code && language === state.language) {
        state.draft = null
      } else if (!state.draft || state.draft.code !== code || state.draft.language !== language) {
        // Still typing. Remember what it looks like and wait for it to settle.
        state.draft = { code, language, since: Date.now() }
      } else if (Date.now() - state.draft.since >= SETTLE_MS) {
        state.code = code
        state.language = language
        state.draft = null
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
      // The submit poll carries a version segment the run poll does not:
      // /submissions/detail/<id>/v2/check/ against /submissions/detail/<id>/check/.
      if (/\/submissions\/detail\/[^/]+\/(?:v\d+\/)?check\/?(\?|$)/.test(url)) {
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
    if (message.source !== window || !message.data) return
    if (message.data.lilo === 'mark') mark(Array.isArray(message.data.lines) ? message.data.lines.filter((n) => Number.isInteger(n)) : [])
    if (message.data.lilo === 'resync') void sayItAgain()
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
