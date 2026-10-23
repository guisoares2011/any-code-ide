// Protocol probe: starts the AnyCode IDE bridge (writing a real lock file in ~/.claude/ide), runs the
// installed `claude` CLI in a PTY with the bridge environment, records every JSON-RPC message for
// a while and stops. No prompt is sent to Claude. Re-run after Claude Code updates.
//
// usage: node scripts/run-bridge-probe.mjs [seconds] [output.json]
import { writeFileSync } from 'node:fs'
import { spawn } from '@lydell/node-pty'
import { text } from '../src/shared/bridge'
import { IdeBridgeServer } from '../src/main/bridge/server'

const seconds = Number(process.argv[2] ?? 20)
const output = process.argv[3] ?? 'out/bridge-probe.json'
const cwd = process.cwd()
const transcript: { t: number; direction: string; message: unknown }[] = []
const started = Date.now()

const server = new IdeBridgeServer({
  ideName: 'AnyCode',
  version: '0.1.0-probe',
  workspaceFolders: () => [cwd],
  handleTool: async (name) => text(name === 'getOpenEditors' ? JSON.stringify({ tabs: [] }) : '{"success":false,"message":"probe"}'),
  trace: (direction, message) => transcript.push({ t: Date.now() - started, direction, message }),
  log: (message) => console.log(`[bridge] ${message}`),
})

const port = await server.start()
const claude = spawn(process.env.SHELL ?? '/bin/zsh', ['-l', '-c', 'exec claude'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd,
  env: { ...process.env, ...server.terminalEnv(), TERM: 'xterm-256color' },
})
let screen = ''
claude.onData((data) => (screen += data))
console.log(`[probe] bridge on ${port}; claude pid ${claude.pid}; recording ${seconds}s`)

await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
claude.kill()
await server.stop()
// Keep only the tail of the terminal output, stripped of escape sequences, for context.
// eslint-disable-next-line no-control-regex
const plain = screen.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-Z]/g, '')
writeFileSync(output, JSON.stringify({ port, seconds, transcript, terminalTail: plain.slice(-3000) }, null, 2))
console.log(`[probe] ${transcript.length} messages -> ${output}`)
process.exit(0)
