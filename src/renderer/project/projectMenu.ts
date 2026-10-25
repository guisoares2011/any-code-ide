// The project view's context menu (IntelliJ's ProjectViewPopupMenu), limited to what AnyCode does:
// New, clipboard, Rename/Delete, Run, Open In, Git and Reload from Disk.
import { dirname, isInside } from '@shared/paths'
import { performAction } from '../keymap/service'
import { runTemporary } from '../run/runState'
import { gitState } from '../state/git'
import { openRollback } from '../vcs/rollback'
import { showFileHistory } from '../vcs/LogView'
import type { MenuItem } from '../ui/ContextMenu'
import { canDebug, debugConfiguration, debugScript } from '../debug/launch'
import { contextConfiguration, isNodeScript } from './contextRun'
import {
  copyFiles,
  copyPath,
  deleteFiles,
  fileClipboard,
  newDirectory,
  newFile,
  newType,
  openInAssociatedApplication,
  openInTerminal,
  pasteFiles,
  renameFile,
  revealInFinder,
  type FileTarget,
} from './fileActions'
import { packageOf } from './templates'

export interface MenuContext {
  target: FileTarget
  /** The project root or the scratches directory: neither can be renamed or deleted. */
  isRoot: boolean
  /** Reloads the target's directory listing (Reload from Disk). */
  reload(): void
}

/** The directory New and Paste act on: the target itself, or a file's parent. */
export const directoryOf = (target: FileTarget): string => (target.kind === 'directory' ? target.path : dirname(target.path))

export function newItems(dir: string): MenuItem[] {
  const where = packageOf(dir)
  return [
    { label: 'File', icon: 'fileTypes/text', actionId: 'NewFile', run: () => void newFile(dir) },
    { label: 'Scratch File', icon: 'fileTypes/scratch', actionId: 'NewScratchFile', run: () => performAction('NewScratchFile') },
    { label: where ? 'Package' : 'Directory', icon: 'nodes/folder', actionId: 'NewDir', run: () => void newDirectory(dir) },
    ...(where
      ? ([
          'separator',
          { label: 'Java Class', icon: 'nodes/class', run: () => void newType(dir, 'java') },
          { label: 'Kotlin Class/File', icon: 'nodes/class', run: () => void newType(dir, 'kotlin') },
        ] satisfies MenuItem[])
      : []),
  ]
}

export function copyPathItems(path: string): MenuItem[] {
  return [
    { label: 'Absolute Path', actionId: 'CopyPaths', run: () => copyPath(path, 'absolute') },
    { label: 'File Name', run: () => copyPath(path, 'name') },
    { label: 'Path From Content Root', run: () => copyPath(path, 'contentRoot') },
  ]
}

export async function projectMenu(context: MenuContext): Promise<MenuItem[]> {
  const { target, isRoot } = context
  const dir = directoryOf(target)
  const configuration = await contextConfiguration(target)
  const debug: MenuItem | null = !configuration
    ? null
    : isNodeScript(target.path)
      ? { label: `Debug '${configuration.name}'`, icon: 'run/debug', actionId: 'DebugClass', run: () => void debugScript(target.path) }
      : canDebug(configuration)
        ? { label: `Debug '${configuration.name}'`, icon: 'run/debug', actionId: 'DebugClass', run: () => void debugConfiguration(configuration) }
        : null
  const git = gitState.get()
  const changed = git.status.files.filter((f) => f.kind !== 'untracked' && isInside(target.path, f.path)).map((f) => f.path)
  const isFile = target.kind !== 'directory'

  return [
    { label: 'New', children: newItems(dir) },
    'separator',
    { label: 'Cut', icon: 'general/cut', actionId: '$Cut', disabled: isRoot, run: () => copyFiles([target.path], 'cut') },
    { label: 'Copy', icon: 'general/copy', actionId: '$Copy', run: () => copyFiles([target.path], 'copy') },
    { label: 'Copy Path/Reference…', children: copyPathItems(target.path) },
    { label: 'Paste', icon: 'general/paste', actionId: '$Paste', disabled: fileClipboard.get().paths.length === 0, run: () => void pasteFiles(dir) },
    'separator',
    { label: 'Rename…', actionId: 'RenameElement', disabled: isRoot, run: () => void renameFile(target) },
    { label: 'Delete…', icon: 'general/delete', actionId: '$Delete', disabled: isRoot, run: () => void deleteFiles([target]) },
    'separator',
    ...(configuration
      ? ([{ label: `Run '${configuration.name}'`, icon: 'run/run', actionId: 'RunClass', run: () => void runTemporary(configuration) }] satisfies MenuItem[])
      : []),
    ...(debug ? [debug] : []),
    'separator',
    {
      label: 'Open In',
      children: [
        { label: 'Finder', icon: 'general/selectIn', actionId: 'RevealIn', run: () => revealInFinder(target.path) },
        { label: 'Terminal', icon: 'toolwindow/terminal@20x20', actionId: 'Terminal.OpenInTerminal', run: () => void openInTerminal(target) },
        ...(isFile ? ([{ label: 'Associated Application', actionId: 'OpenInAssociatedApplication', run: () => void openInAssociatedApplication(target.path) }] satisfies MenuItem[]) : []),
      ],
    },
    'separator',
    ...(git.status.repository
      ? ([
          {
            label: 'Git',
            children: [
              { label: 'Show History', icon: 'general/history', actionId: 'Vcs.ShowTabbedFileHistory', disabled: !isFile, run: () => showFileHistory(target.path) },
              { label: 'Rollback…', icon: 'vcs/revert', actionId: 'ChangesView.Revert', disabled: changed.length === 0, run: () => openRollback(changed) },
            ],
          },
        ] satisfies MenuItem[])
      : []),
    { label: 'Reload from Disk', icon: 'general/refresh', actionId: 'SynchronizeCurrentFile', run: context.reload },
  ]
}

