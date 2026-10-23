// User settings, loaded once at startup and rewritten on every change from the Settings dialog.
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '@shared/settings'
import { handle } from './ipc'

let current: Settings = DEFAULT_SETTINGS

export const currentSettings = (): Settings => current

/** The shell for terminals and run configurations: the configured one, else $SHELL. */
export const userShell = (): string => current.terminal.shell || process.env.SHELL || '/bin/zsh'

export function loadSettings(file: string): Settings {
  try {
    current = normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    current = DEFAULT_SETTINGS // first run, or a file that is not JSON
  }
  return current
}

async function save(file: string, settings: Settings): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

export function registerSettingsHandlers(file: string): void {
  loadSettings(file)
  handle('settings:get', () => current)
  handle('settings:set', async (settings) => {
    current = normalizeSettings(settings)
    await save(file, current)
    return current
  })
}
