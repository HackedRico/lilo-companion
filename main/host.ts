import { connect } from 'node:net'
import { Decoder, encode } from './leetcode/framing.ts'

/**
 * The native messaging host Chrome launches for the extension. It is the app's
 * own binary run as plain Node, and it does one thing: relay Chrome's framed
 * messages to the running app over a local socket, and lines from the socket
 * back to Chrome. When the app is not running it exits, and the extension
 * tries again later.
 */
const path = process.argv[2]
if (!path) process.exit(2)

const socket = connect(path)
const decoder = new Decoder()
let pending = ''

socket.on('connect', () => {
  process.stdin.on('data', (chunk: Buffer) => {
    for (const message of decoder.push(chunk)) socket.write(`${JSON.stringify(message)}\n`)
  })
  process.stdin.on('end', () => socket.end())
})

socket.on('data', (chunk: Buffer) => {
  pending += chunk.toString('utf8')
  const lines = pending.split('\n')
  pending = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      process.stdout.write(encode(JSON.parse(line)))
    } catch {
      // The app only ever writes JSON; anything else is not for Chrome.
    }
  }
})

socket.on('error', () => process.exit(0))
socket.on('close', () => process.exit(0))
