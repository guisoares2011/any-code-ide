// Scratch files (NewScratchFile ⇧⌘N): throwaway files in AnyCode's scratches directory, shared by
// every project, listed under "Scratches and Consoles" in the project view like IntelliJ's.
import { extname, isInside } from '@shared/paths'
import { notify } from '../state/notifications'
import { createStore } from '../state/store'
import { openFile, relocateTabs, workbench } from '../state/workbench'
import { relocateDocuments } from '../editor/documents'

export interface ScratchLanguage {
  name: string
  extension: string
  icon: string
}

/** Languages offered by New Scratch File, in IntelliJ's order of usefulness for this stack. */
export const SCRATCH_LANGUAGES: readonly ScratchLanguage[] = [
  { name: 'Plain text', extension: 'txt', icon: 'fileTypes/text' },
  { name: 'Markdown', extension: 'md', icon: 'fileTypes/text' },
  { name: 'JSON', extension: 'json', icon: 'fileTypes/json' },
  { name: 'YAML', extension: 'yaml', icon: 'fileTypes/yaml' },
  { name: 'XML', extension: 'xml', icon: 'fileTypes/xml' },
  { name: 'HTML', extension: 'html', icon: 'fileTypes/html' },
  { name: 'CSS', extension: 'css', icon: 'fileTypes/css' },
  { name: 'JavaScript', extension: 'js', icon: 'fileTypes/javaScript' },
  { name: 'TypeScript', extension: 'ts', icon: 'fileTypes/javaScript' },
  { name: 'Java', extension: 'java', icon: 'fileTypes/java' },
  { name: 'Kotlin', extension: 'kt', icon: 'fileTypes/unknown' },
  { name: 'Shell Script', extension: 'sh', icon: 'fileTypes/shell' },
  { name: 'Python', extension: 'py', icon: 'fileTypes/text' },
  { name: 'SQL', extension: 'sql', icon: 'fileTypes/text' },
  { name: 'Properties', extension: 'properties', icon: 'fileTypes/properties' },
]

export const scratchState = createStore<{ dir: string | null }>({ dir: null })

export async function loadScratchDir(): Promise<string> {
  const known = scratchState.get().dir
  if (known) return known
  const dir = await window.anycode.invoke('scratch:dir')
  scratchState.set({ dir })
  return dir
}

export function isScratch(path: string): boolean {
  const dir = scratchState.get().dir
  return dir !== null && isInside(dir, path) && path !== dir
}

/** The language of the active editor first, as IntelliJ preselects it. */
export function scratchLanguages(): ScratchLanguage[] {
  const { activeTab } = workbench.get()
  const extension = activeTab ? extname(activeTab).slice(1).toLowerCase() : ''
  const index = SCRATCH_LANGUAGES.findIndex((l) => l.extension === extension || (extension === 'yml' && l.extension === 'yaml'))
  return index <= 0 ? [...SCRATCH_LANGUAGES] : [SCRATCH_LANGUAGES[index]!, ...SCRATCH_LANGUAGES.filter((_, i) => i !== index)]
}

export async function createScratch(language: ScratchLanguage, content = ''): Promise<void> {
  await loadScratchDir()
  try {
    openFile(await window.anycode.invoke('scratch:create', language.extension, content))
  } catch (error) {
    notify('error', 'Cannot create scratch file', error instanceof Error ? error.message : String(error))
  }
}

/** Change File Language: a scratch keeps its name and gets the language's extension. */
export async function changeScratchLanguage(path: string, language: ScratchLanguage): Promise<void> {
  const current = extname(path)
  const target = `${current ? path.slice(0, -current.length) : path}.${language.extension}`
  if (target === path) return
  try {
    await window.anycode.invoke('fs:rename', path, target)
  } catch (error) {
    notify('error', 'Cannot change the language', error instanceof Error ? error.message : String(error))
    return
  }
  await relocateDocuments(path, target)
  relocateTabs(path, target)
}
