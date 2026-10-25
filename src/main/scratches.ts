// Scratch files (IntelliJ's NewScratchFile): files outside every project, in one directory of
// AnyCode's data shared by all projects and windows, like IntelliJ's config/scratches.
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createFile } from './fs'
import { handle } from './ipc'
import { allowRoot } from './project'

/** IntelliJ's names: scratch.ts, scratch_1.ts, scratch_2.ts... */
export function nextScratchName(dir: string, extension: string): string {
  const ext = extension ? `.${extension.replace(/^\./, '')}` : ''
  for (let n = 0; ; n++) {
    const name = `scratch${n === 0 ? '' : `_${n}`}${ext}`
    if (!existsSync(join(dir, name))) return name
  }
}

export function registerScratchHandlers(dir: string): void {
  allowRoot(dir)
  handle('scratch:dir', async () => {
    await mkdir(dir, { recursive: true })
    return dir
  })
  handle('scratch:create', async (extension, content) => {
    await mkdir(dir, { recursive: true })
    const path = join(dir, nextScratchName(dir, extension))
    await createFile(path, content)
    return path
  })
}
