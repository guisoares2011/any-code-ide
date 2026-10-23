// Pending openDiff calls from Claude Code. Each one is a diff tab; accepting answers FILE_SAVED plus
// the final (possibly user-edited) contents, which Claude then writes to disk. Rejecting or closing
// the tab answers DIFF_REJECTED. Same contract as coder/claudecode.nvim.
import { text, type McpToolResult } from '@shared/bridge'
import { basename } from '@shared/paths'
import { createStore } from '../state/store'
import { closeTab, diffTabKey, openDiffTab, openFile, workbench } from '../state/workbench'

export interface PendingDiff {
  tabName: string
  oldPath: string
  newPath: string
  original: string
  proposed: string
  isNewFile: boolean
}

interface Entry extends PendingDiff {
  resolve(result: McpToolResult): void
}

const entries = new Map<string, Entry>()
/** Bumps when the set of pending diffs changes, for components. */
export const diffVersion = createStore({ version: 0 })

const changed = (): void => diffVersion.set((s) => ({ version: s.version + 1 }))

export function pendingDiff(tabName: string): PendingDiff | undefined {
  return entries.get(tabName)
}

export function pendingDiffByKey(tabKey: string): PendingDiff | undefined {
  return [...entries.values()].find((e) => diffTabKey(e.tabName) === tabKey)
}

export async function openDiff(args: {
  old_file_path: string
  new_file_path: string
  new_file_contents: string
  tab_name: string
}): Promise<McpToolResult> {
  let original = ''
  let isNewFile = false
  try {
    const content = await window.anycode.invoke('fs:readFile', args.old_file_path)
    if (content.kind !== 'text') return { ...text(`Cannot diff a ${content.kind} file`), isError: true }
    original = content.content
  } catch {
    // Missing file: Claude is creating it.
    isNewFile = true
  }
  // A new diff with the same name replaces the previous one.
  entries.get(args.tab_name)?.resolve(text('DIFF_REJECTED'))
  return new Promise((resolve) => {
    entries.set(args.tab_name, {
      tabName: args.tab_name,
      oldPath: args.old_file_path,
      newPath: args.new_file_path,
      original,
      proposed: args.new_file_contents,
      isNewFile,
      resolve,
    })
    changed()
    openDiffTab(args.tab_name, `${basename(args.new_file_path)} (proposed)`)
  })
}

function finish(tabName: string, result: McpToolResult): string | null {
  const entry = entries.get(tabName)
  if (!entry) return null
  entries.delete(tabName)
  entry.resolve(result)
  closeTab(diffTabKey(tabName))
  changed()
  return entry.newPath
}

/** Accept with the final contents shown in the diff's right side. */
export function acceptDiff(tabName: string, finalContents: string): void {
  const path = finish(tabName, {
    content: [
      { type: 'text', text: 'FILE_SAVED' },
      { type: 'text', text: finalContents },
    ],
  })
  // Claude writes the file; the watcher reloads the editor once it lands.
  if (path && workbench.get().project) openFile(path)
}

export function rejectDiff(tabName: string): void {
  finish(tabName, text('DIFF_REJECTED'))
}

/** Closing a diff tab by hand rejects it. */
export function rejectDiffByKey(tabKey: string): boolean {
  const entry = pendingDiffByKey(tabKey)
  if (!entry) return false
  rejectDiff(entry.tabName)
  return true
}

export function rejectAllDiffs(): number {
  const names = [...entries.keys()]
  for (const name of names) rejectDiff(name)
  return names.length
}
