// The extension's whole job: hand events from the page to the native host,
// which is the Lilo app on this machine, and hand its marks back to the page.
// Nothing is stored and nothing goes anywhere else.
const HOST = 'com.lilo.companion'
const PROBLEMS = 'https://leetcode.com/problems/*'

/**
 * The tab the app's state is about: the last one to say what is open or what
 * is written. The app folds one problem out of whatever arrives, so a mark
 * belongs to the tab that named it and to no other. A second problem tab was
 * getting the first one's lines highlighted.
 */
let speaking = null

let port = null
let retryAfter = 0
let backoff = 2000

function connect() {
  if (port) return port
  if (Date.now() < retryAfter) return null
  try {
    port = chrome.runtime.connectNative(HOST)
  } catch {
    port = null
    retryAfter = Date.now() + backoff
    backoff = Math.min(backoff * 2, 60000)
    return null
  }
  port.onMessage.addListener((message) => {
    if (!message) return
    if (message.mark) {
      // Until a tab has said what it has, there is no tab a mark is about.
      if (speaking !== null) chrome.tabs.sendMessage(speaking, { mark: message.mark }).catch(() => {})
      return
    }
    // The app has just come up and knows nothing about a tab that has been
    // sitting still, so every problem tab says what it has again. The tab in
    // front is asked last, because the app keeps the problem it hears about last.
    if (message.resync === true) {
      chrome.tabs.query({ url: PROBLEMS }, (tabs) => {
        const ordered = tabs.filter((tab) => typeof tab.id === 'number').sort((a, b) => Number(a.active) - Number(b.active))
        for (const tab of ordered) chrome.tabs.sendMessage(tab.id, { resync: true }).catch(() => {})
      })
    }
  })
  port.onDisconnect.addListener(() => {
    // The app is not running, or Chrome has no host registered yet. Try again later, not on every keystroke.
    const err = chrome.runtime.lastError
    if (err) console.log('[lilo] native host disconnected:', err.message)
    port = null
    retryAfter = Date.now() + backoff
    backoff = Math.min(backoff * 2, 60000)
  })
  backoff = 2000
  return port
}

// Connect proactively on startup so Lilo's settings page shows connection immediately
connect()

chrome.runtime.onInstalled?.addListener(() => {
  connect()
})

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || !message.event) return
  const kind = message.event.kind
  if (sender.tab && (kind === 'opened' || kind === 'changed')) speaking = sender.tab.id
  const live = connect()
  if (!live) return
  try {
    live.postMessage({ event: message.event })
  } catch {
    port = null
  }
})

