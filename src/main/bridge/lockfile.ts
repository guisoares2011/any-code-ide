// Discovery lock file Claude Code reads: <config dir>/ide/<port>.lock (CLAUDE_CONFIG_DIR or ~/.claude).
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface LockFileContent {
  pid: number
  workspaceFolders: string[]
  ideName: string
  transport: 'ws'
  authToken: string
}

export function lockDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'ide')
}

/** 128-bit token, 32 lowercase hex characters, from the OS CSPRNG. Never log it. */
export function generateAuthToken(): string {
  return randomBytes(16).toString('hex')
}

/** Writes the lock atomically with 0600 permissions inside a 0700 directory; returns its path. */
export async function writeLockFile(directory: string, port: number, content: LockFileContent): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700).catch(() => undefined)
  const path = join(directory, `${port}.lock`)
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(content), { mode: 0o600 })
  await rename(temporary, path)
  return path
}

export async function removeLockFile(path: string): Promise<void> {
  await rm(path, { force: true })
}
