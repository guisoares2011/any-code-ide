// File operations of the project view, after IntelliJ's: New (File, Directory/Package, Java and
// Kotlin classes), Rename, Delete, Cut/Copy/Paste, Copy Path and the "Open In" group.
import { basename, dirname, relativePath } from '@shared/paths'
import { relocateBreakpoints } from '../debug/breakpoints'
import { discardDocuments, relocateDocuments } from '../editor/documents'
import { notify } from '../state/notifications'
import { projectRootOf } from '../state/projects'
import { createStore } from '../state/store'
import { openFile, relocateTabs, showToolWindow, workbench } from '../state/workbench'
import { terminalGroupFor } from '../terminal/ptySessions'
import { askConfirm, askInput, type InputChoice } from '../ui/dialogs'
import { packageOf, typeTemplate } from './templates'

export interface FileTarget {
  path: string
  kind: 'file' | 'directory' | 'symlink'
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error))

/** Runs a file operation; a failure becomes an error notification and null. */
async function attempt<T>(title: string, task: () => Promise<T>): Promise<{ value: T } | null> {
  try {
    return { value: await task() }
  } catch (error) {
    notify('error', title, errorText(error))
    return null
  }
}

/** A typed name that may contain subdirectories ("a/b/c.txt"); null when it is acceptable. */
function nameProblem(name: string): string | null {
  if (name.startsWith('/')) return 'Enter a relative name'
  if (name.split('/').some((part) => part === '..' || part === '.')) return "'.' and '..' are not allowed"
  return null
}

async function existsProblem(path: string): Promise<string | null> {
  return (await window.anycode.invoke('fs:exists', path)) ? `'${basename(path)}' already exists` : null
}

export async function newFile(dir: string): Promise<void> {
  const answer = await askInput({
    title: 'New File',
    label: 'Name (subdirectories with /)',
    validate: async (name) => nameProblem(name) ?? existsProblem(`${dir}/${name}`),
  })
  if (!answer) return
  const path = `${dir}/${answer.value}`
  if (!(await attempt('Cannot create file', () => window.anycode.invoke('fs:createFile', path)))) return
  openFile(path)
}

/** New › Directory, or New › Package inside a Java/Kotlin source root (dots become directories). */
export async function newDirectory(dir: string): Promise<void> {
  const asPackage = packageOf(dir) !== null
  const answer = await askInput({
    title: asPackage ? 'New Package' : 'New Directory',
    label: asPackage ? 'Package name' : 'Name (subdirectories with /)',
    validate: async (name) => {
      const relative = asPackage ? name.replaceAll('.', '/') : name
      if (asPackage && !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name)) return 'Not a valid package name'
      return nameProblem(relative) ?? existsProblem(`${dir}/${relative}`)
    },
  })
  if (!answer) return
  const relative = asPackage ? answer.value.replaceAll('.', '/') : answer.value
  await attempt('Cannot create directory', () => window.anycode.invoke('fs:createDirectory', `${dir}/${relative}`))
}

const JAVA_KINDS: InputChoice[] = [
  { id: 'class', label: 'Class', icon: 'nodes/class' },
  { id: 'interface', label: 'Interface', icon: 'nodes/interface' },
  { id: 'enum', label: 'Enum', icon: 'nodes/enum' },
  { id: 'record', label: 'Record', icon: 'nodes/class' },
  { id: '@interface', label: 'Annotation', icon: 'nodes/interface' },
]

const KOTLIN_KINDS: InputChoice[] = [
  { id: 'class', label: 'Class', icon: 'nodes/class' },
  { id: 'file', label: 'File', icon: 'fileTypes/unknown' },
  { id: 'interface', label: 'Interface', icon: 'nodes/interface' },
  { id: 'data class', label: 'Data class', icon: 'nodes/class' },
  { id: 'enum class', label: 'Enum class', icon: 'nodes/enum' },
  { id: 'object', label: 'Object', icon: 'nodes/class' },
]

/** New › Java Class / Kotlin Class/File; "sub.Name" also creates the sub-package. */
export async function newType(dir: string, language: 'java' | 'kotlin'): Promise<void> {
  const where = packageOf(dir)
  const extension = language === 'java' ? '.java' : '.kt'
  const split = (value: string): { subPackage: string; name: string } => {
    const dot = value.lastIndexOf('.')
    return dot < 0 ? { subPackage: '', name: value } : { subPackage: value.slice(0, dot), name: value.slice(dot + 1) }
  }
  const answer = await askInput({
    title: language === 'java' ? 'New Java Class' : 'New Kotlin Class/File',
    choices: language === 'java' ? JAVA_KINDS : KOTLIN_KINDS,
    validate: async (value) => {
      if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(value)) return 'Not a valid name'
      const { subPackage, name } = split(value)
      return existsProblem(`${dir}/${subPackage ? `${subPackage.replaceAll('.', '/')}/` : ''}${name}${extension}`)
    },
  })
  if (!answer) return
  const { subPackage, name } = split(answer.value)
  const packageName = [where?.packageName, subPackage].filter(Boolean).join('.')
  const path = `${dir}/${subPackage ? `${subPackage.replaceAll('.', '/')}/` : ''}${name}${extension}`
  const content = typeTemplate(language, answer.choice ?? 'class', packageName, name)
  if (!(await attempt('Cannot create file', () => window.anycode.invoke('fs:createFile', path, content)))) return
  openFile(path)
}

async function afterMove(from: string, to: string): Promise<void> {
  await relocateDocuments(from, to)
  relocateTabs(from, to)
  relocateBreakpoints(from, to)
}

/** Rename… (⇧F6): the name is selected without its extension, like IntelliJ's Rename File dialog. */
export async function renameFile(target: FileTarget): Promise<void> {
  const name = basename(target.path)
  const dot = name.lastIndexOf('.')
  const parent = dirname(target.path)
  const answer = await askInput({
    title: target.kind === 'directory' ? 'Rename Directory' : 'Rename File',
    label: `Rename ${target.kind === 'directory' ? 'directory' : 'file'} '${name}' to:`,
    initial: name,
    selection: [0, target.kind !== 'directory' && dot > 0 ? dot : name.length],
    confirmLabel: 'Refactor',
    validate: async (value) => {
      if (value.includes('/')) return 'Enter a name without /'
      if (value === name || value.toLowerCase() === name.toLowerCase()) return null
      return existsProblem(`${parent}/${value}`)
    },
  })
  if (!answer || answer.value === name) return
  const to = `${parent}/${answer.value}`
  if (!(await attempt('Cannot rename', () => window.anycode.invoke('fs:rename', target.path, to)))) return
  await afterMove(target.path, to)
}

/** Delete (⌫): asks first, then moves to the Trash and closes their tabs. */
export async function deleteFiles(targets: readonly FileTarget[]): Promise<void> {
  if (targets.length === 0) return
  const first = targets[0]!
  const message =
    targets.length > 1
      ? `Delete ${targets.length} items?`
      : `Delete ${first.kind === 'directory' ? 'directory' : 'file'} '${basename(first.path)}'?`
  const answer = await askConfirm({ title: 'Delete', message: `${message} They go to the Trash.`, confirmLabel: 'Delete' })
  if (!answer) return
  const paths = targets.map((t) => t.path)
  if (!(await attempt('Cannot delete', () => window.anycode.invoke('fs:trash', paths)))) return
  await discardDocuments(paths)
}

/** Files put on AnyCode's clipboard by Cut or Copy in the project view. */
export const fileClipboard = createStore<{ paths: string[]; mode: 'copy' | 'cut' }>({ paths: [], mode: 'copy' })

export function copyFiles(paths: string[], mode: 'copy' | 'cut'): void {
  fileClipboard.set({ paths, mode })
  // Also as text, so the paths can be pasted into the terminal or a chat with Claude.
  void navigator.clipboard.writeText(paths.join('\n'))
}

export async function pasteFiles(dir: string): Promise<void> {
  const { paths, mode } = fileClipboard.get()
  if (paths.length === 0) return
  if (mode === 'copy') {
    await attempt('Cannot paste', () => window.anycode.invoke('fs:copyInto', paths, dir))
    return
  }
  if (!(await attempt('Cannot move', () => window.anycode.invoke('fs:moveInto', paths, dir)))) return
  for (const source of paths) {
    const target = `${dir}/${basename(source)}`
    if (target !== source) await afterMove(source, target)
  }
  fileClipboard.set({ paths: [], mode: 'copy' })
}

export type PathKind = 'absolute' | 'name' | 'contentRoot'

/** Copy Path/Reference… (⇧⌘C): absolute path, file name or path from the project root. */
export function copyPath(path: string, kind: PathKind): void {
  const root = projectRootOf(path)
  const text = kind === 'name' ? basename(path) : kind === 'contentRoot' && root ? relativePath(root, path) || '.' : path
  void navigator.clipboard.writeText(text)
}

export function revealInFinder(path: string): void {
  void window.anycode.invoke('shell:reveal', path)
}

export async function openInAssociatedApplication(path: string): Promise<void> {
  const problem = await window.anycode.invoke('shell:openPath', path)
  if (problem) notify('error', 'Cannot open file', problem)
}

/** Open In › Terminal: a new terminal tab in the directory (a file's parent). */
export async function openInTerminal(target: FileTarget): Promise<void> {
  const dir = target.kind === 'directory' ? target.path : dirname(target.path)
  // Scratch files belong to no project: their terminal opens in the project shown.
  const group = terminalGroupFor(projectRootOf(dir) ?? workbench.get().project?.root)
  showToolWindow('Terminal')
  await group.create({ title: basename(dir), cwd: dir })
  group.focusActive()
}
