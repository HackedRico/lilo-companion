// The extension's whole job: hand events from the page to the native host,
// which is the Lilo app on this machine, and hand its marks back to the page.
// Nothing is stored and nothing goes anywhere else.
const HOST = 'com.lilo.companion'

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
    if (!message || !message.mark) return
    chrome.tabs.query({ url: 'https://leetcode.com/problems/*' }, (tabs) => {
      for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { mark: message.mark }).catch(() => {})
    })
  })
  port.onDisconnect.addListener(() => {
    // The app is not running, or Chrome has no host registered yet. Try again later, not on every keystroke.
    port = null
    retryAfter = Date.now() + backoff
    backoff = Math.min(backoff * 2, 60000)
  })
  backoff = 2000
  return port
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.event) return
  const live = connect()
  if (!live) return
  try {
    live.postMessage({ event: message.event })
  } catch {
    port = null
  }
})
