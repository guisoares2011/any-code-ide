import type { DirEntry } from '@shared/ipc'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Project view order: directories first, then files, each by natural name order. */
export function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries]
    .filter((e) => e.name !== '.DS_Store')
    .sort((a, b) => {
      const dirA = a.kind === 'directory' ? 0 : 1
      const dirB = b.kind === 'directory' ? 0 : 1
      return dirA - dirB || collator.compare(a.name, b.name)
    })
}
