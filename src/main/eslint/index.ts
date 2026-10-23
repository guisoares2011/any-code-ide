// ESLint workers: one per project root, started on the first lint request and restarted when the
// project's ESLint setup changes. The worker runs the project's own ESLint (see worker.ts).
import { fork, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { FixResult, LintResult } from '@shared/eslint'
import { handle } from '../ipc'
import { assertInsideProject } from '../project'
import type { WorkerReply, WorkerRequest } from './worker'

const REQUEST_TIMEOUT_MS = 30_000

interface Worker {
  child: ChildProcess
  pending: Map<number, (result: LintResult | FixResult) => void>
}

const workers = new Map<string, Worker>()
let nextId = 0

function workerFor(root: string): Worker {
  const existing = workers.get(root)
  if (existing) return existing
  // Electron itself, as plain Node: no extra runtime to install.
  const child = fork(join(__dirname, 'eslintWorker.js'), [root], {
    cwd: root,
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  const worker: Worker = { child, pending: new Map() }
  child.on('message', (reply: WorkerReply) => {
    worker.pending.get(reply.id)?.(reply.result)
    worker.pending.delete(reply.id)
  })
  child.on('exit', () => {
    if (workers.get(root) === worker) workers.delete(root)
    for (const resolve of worker.pending.values()) resolve({ status: 'error', message: 'ESLint stopped' })
    worker.pending.clear()
  })
  workers.set(root, worker)
  return worker
}

function request(root: string, filePath: string, text: string, fix: boolean): Promise<LintResult | FixResult> {
  const worker = workerFor(root)
  const id = ++nextId
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.pending.delete(id)
      resolve({ status: 'error', message: 'ESLint did not answer in time' })
    }, REQUEST_TIMEOUT_MS)
    worker.pending.set(id, (result) => {
      clearTimeout(timer)
      resolve(result)
    })
    worker.child.send({ id, filePath, text, fix } satisfies WorkerRequest)
  })
}

export function stopEslint(root: string): void {
  workers.get(root)?.child.kill()
  workers.delete(root)
}

export function stopAllEslint(): void {
  for (const root of [...workers.keys()]) stopEslint(root)
}

export function registerEslintHandlers(): void {
  handle('eslint:lint', async (root, path, text) => (await request(assertInsideProject(root), assertInsideProject(path), text, false)) as LintResult)
  handle('eslint:fix', async (root, path, text) => (await request(assertInsideProject(root), assertInsideProject(path), text, true)) as FixResult)
  handle('eslint:reset', (root) => stopEslint(assertInsideProject(root)))
}
