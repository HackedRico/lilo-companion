// The isolated half of the content script. It can reach chrome.runtime and
// the page's agent cannot, so events cross here on their way out and marks on
// their way in. Only messages from this window are believed.
window.addEventListener('message', (message) => {
  if (message.source !== window || !message.data || message.data.lilo !== 'event') return
  chrome.runtime.sendMessage({ event: message.data.event }).catch(() => {})
})

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return
  if (message.mark) window.postMessage({ lilo: 'mark', lines: message.mark.lines }, location.origin)
  if (message.resync === true) window.postMessage({ lilo: 'resync' }, location.origin)
})
