import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DirEntry, ProjectInfo } from '@shared/ipc'
import { useActions } from '../keymap/service'
import { openFile, workbench } from '../state/workbench'
import { gitState } from '../state/git'
import { useStore } from '../state/store'
import { showContextMenu, type MenuItem } from '../ui/ContextMenu'
import { Icon } from '../ui/Icon'
import { fileIconName } from '../ui/icons'
import { dirname } from '@shared/paths'
import { loadScratchDir, scratchState } from '../scratch/scratches'
import { copyFiles, deleteFiles, fileClipboard, openInAssociatedApplication, openInTerminal, pasteFiles, renameFile, revealInFinder, type FileTarget } from './fileActions'
import { mavenDecorations, type DirDecoration } from './moduleRoots'
import { copyPathItems, directoryOf, newItems, projectMenu } from './projectMenu'
import { sortEntries } from './sortEntries'

/** Key of IntelliJ's "Scratches and Consoles" node, which is not a directory. */
const SCRATCH_GROUP = 'anycode:scratches'

interface Row {
  entry: DirEntry
  depth: number
  expanded: boolean
}

export function ProjectView() {
  const project = useStore(workbench, (s) => s.project)
  if (!project) return <div className="empty-state">No project open</div>
  return <ProjectTree key={project.root} project={project} />
}

function ProjectTree({ project }: { project: ProjectInfo }) {
  const focus = useStore(workbench, (s) => s.focus)
  const vcs = useStore(gitState, (s) => s.byPath)
  const [children, setChildren] = useState(new Map<string, DirEntry[]>())
  const [expanded, setExpanded] = useState(() => new Set<string>([project.root]))
  const [selected, setSelected] = useState<string | null>(project.root)
  const [decorations, setDecorations] = useState(new Map<string, DirDecoration>())
  const scratchDir = useStore(scratchState, (s) => s.dir)
  const clipboard = useStore(fileClipboard, (s) => s)
  const treeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadScratchDir()
  }, [])

  // Maven modules and source roots, like IntelliJ after importing the reactor; reread when a pom changes.
  useEffect(() => {
    let cancelled = false
    const read = (): void => {
      void window.anycode.invoke('maven:modules', project.root).then((modules) => {
        if (!cancelled) setDecorations(mavenDecorations(project.root, modules))
      })
    }
    read()
    const off = window.anycode.on('fs:changed', (paths) => {
      if (paths.some((p) => p.endsWith('/pom.xml') && p.startsWith(`${project.root}/`))) read()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [project.root])

  const load = useCallback(async (dir: string) => {
    if (dir === SCRATCH_GROUP) return
    const entries = await window.anycode.invoke('fs:readDir', dir)
    setChildren((prev) => new Map(prev).set(dir, sortEntries(entries)))
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.anycode.invoke('fs:readDir', project.root).then((entries) => {
      if (!cancelled) setChildren((prev) => new Map(prev).set(project.root, sortEntries(entries)))
    })
    return () => {
      cancelled = true
    }
  }, [project.root])

  useEffect(() => {
    if (focus.target === 'Project') treeRef.current?.focus()
  }, [focus])

  const rows = useMemo(() => {
    const result: Row[] = []
    const visit = (entry: DirEntry, depth: number): void => {
      const isOpen = expanded.has(entry.path)
      result.push({ entry, depth, expanded: isOpen })
      if (isOpen) for (const child of children.get(entry.path) ?? []) visit(child, depth + 1)
    }
    visit({ name: project.name, path: project.root, kind: 'directory' }, 0)
    if (scratchDir) {
      const isOpen = expanded.has(SCRATCH_GROUP)
      result.push({ entry: { name: 'Scratches and Consoles', path: SCRATCH_GROUP, kind: 'directory' }, depth: 0, expanded: isOpen })
      if (isOpen) visit({ name: 'Scratches', path: scratchDir, kind: 'directory' }, 1)
    }
    return result
  }, [project, expanded, children, scratchDir])

  const toggle = useCallback(
    (path: string, open?: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        const shouldOpen = open ?? !prev.has(path)
        if (shouldOpen) {
          next.add(path)
          if (!children.has(path)) void load(path)
        } else next.delete(path)
        return next
      })
    },
    [children, load],
  )

  const activate = useCallback(
    (row: Row, focusEditor: boolean) => {
      if (row.entry.kind === 'directory') toggle(row.entry.path)
      else openFile(row.entry.path, focusEditor)
    },
    [toggle],
  )

  // Refresh loaded directories when files appear, vanish or change on disk.
  const childrenRef = useRef(children)
  useLayoutEffect(() => {
    childrenRef.current = children
  })
  useEffect(
    () =>
      window.anycode.on('fs:changed', (paths) => {
        const dirs = new Set(paths.flatMap((p) => [dirname(p), p]).filter((d) => childrenRef.current.has(d)))
        for (const dir of dirs) {
          void window.anycode
            .invoke('fs:readDir', dir)
            .then((entries) => setChildren((prev) => new Map(prev).set(dir, sortEntries(entries))))
            .catch(() => setChildren((prev) => {
              const next = new Map(prev)
              next.delete(dir)
              return next
            }))
        }
      }),
    [],
  )

  // Keep the selected row visible.
  useEffect(() => {
    if (!selected) return
    treeRef.current?.querySelector(`[data-path="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  /** The project root, the scratches directory and their group cannot be renamed, moved or deleted. */
  const isFixed = useCallback((path: string) => path === project.root || path === scratchDir || path === SCRATCH_GROUP, [project.root, scratchDir])

  const reload = useCallback(
    (path: string) => {
      for (const dir of [path, dirname(path)]) if (children.has(dir)) void load(dir)
    },
    [children, load],
  )

  const openMenu = useCallback(
    async (row: Row, x: number, y: number) => {
      if (row.entry.path === SCRATCH_GROUP) return
      const target: FileTarget = { path: row.entry.path, kind: row.entry.kind }
      const items = await projectMenu({
        target,
        isRoot: isFixed(target.path),
        reload: () => reload(target.path),
      })
      showContextMenu(x, y, items)
    },
    [isFixed, reload],
  )

  const state = useRef({ rows, selected, toggle, activate, openMenu, isFixed, reload })
  useLayoutEffect(() => {
    state.current = { rows, selected, toggle, activate, openMenu, isFixed, reload }
  })

  useActions(() => {
    const inTree = (): boolean => treeRef.current?.contains(document.activeElement) ?? false
    const move = (delta: number | 'first' | 'last') => () => {
      const { rows: list, selected: current } = state.current
      if (list.length === 0) return
      const index = list.findIndex((r) => r.entry.path === current)
      const target =
        delta === 'first' ? 0 : delta === 'last' ? list.length - 1 : Math.min(Math.max(index + delta, 0), list.length - 1)
      setSelected(list[target]!.entry.path)
    }
    const selectedRow = (): Row | undefined => state.current.rows.find((r) => r.entry.path === state.current.selected)
    const selectedTarget = (): FileTarget | undefined => {
      const row = selectedRow()
      return row && row.entry.path !== SCRATCH_GROUP ? { path: row.entry.path, kind: row.entry.kind } : undefined
    }
    /** Menus opened from the keyboard appear under the selected row. */
    const belowSelection = (items: MenuItem[]): void => {
      const element = treeRef.current?.querySelector(`[data-path="${CSS.escape(state.current.selected ?? '')}"]`)
      const box = element?.getBoundingClientRect()
      if (box) showContextMenu(box.left + 24, box.bottom, items)
    }
    const onTarget = (perform: (target: FileTarget) => void) => () => {
      const target = selectedTarget()
      if (target) perform(target)
    }
    const movable = (): boolean => inTree() && selectedTarget() !== undefined && !state.current.isFixed(state.current.selected ?? '')
    const hasTarget = (): boolean => inTree() && selectedTarget() !== undefined
    const fileClipboardFull = (): boolean => hasTarget() && fileClipboard.get().paths.length > 0
    const fileTarget = (): boolean => hasTarget() && selectedTarget()?.kind !== 'directory'
    return [
      { id: 'NewElement', isEnabled: hasTarget, perform: onTarget((t) => belowSelection(newItems(directoryOf(t)))) },
      { id: 'RenameElement', isEnabled: movable, perform: onTarget((t) => void renameFile(t)) },
      { id: '$Delete', isEnabled: movable, perform: onTarget((t) => void deleteFiles([t])) },
      { id: '$Cut', isEnabled: movable, perform: onTarget((t) => copyFiles([t.path], 'cut')) },
      { id: '$Copy', isEnabled: hasTarget, perform: onTarget((t) => copyFiles([t.path], 'copy')) },
      { id: '$Paste', isEnabled: fileClipboardFull, perform: onTarget((t) => void pasteFiles(directoryOf(t))) },
      { id: 'CopyPaths', text: 'Copy Path/Reference…', isEnabled: hasTarget, perform: onTarget((t) => belowSelection(copyPathItems(t.path))) },
      { id: 'RevealIn', text: 'Reveal in Finder', isEnabled: hasTarget, perform: onTarget((t) => revealInFinder(t.path)) },
      { id: 'Terminal.OpenInTerminal', text: 'Open in Terminal', isEnabled: hasTarget, perform: onTarget((t) => void openInTerminal(t)) },
      { id: 'OpenInAssociatedApplication', isEnabled: fileTarget, perform: onTarget((t) => void openInAssociatedApplication(t.path)) },
      { id: 'SynchronizeCurrentFile', isEnabled: hasTarget, perform: onTarget((t) => state.current.reload(t.path)) },
      {
        id: 'ShowPopupMenu',
        isEnabled: hasTarget,
        perform: () => {
          const row = selectedRow()
          const element = treeRef.current?.querySelector(`[data-path="${CSS.escape(state.current.selected ?? '')}"]`)
          const box = element?.getBoundingClientRect()
          if (row && box) void state.current.openMenu(row, box.left + 24, box.bottom)
        },
      },
      { id: 'Tree-selectNext', isEnabled: inTree, perform: move(1) },
      { id: 'Tree-selectPrevious', isEnabled: inTree, perform: move(-1) },
      { id: 'Tree-selectFirst', isEnabled: inTree, perform: move('first') },
      { id: 'Tree-selectLast', isEnabled: inTree, perform: move('last') },
      {
        id: 'Tree-selectChild',
        isEnabled: inTree,
        perform: () => {
          const row = selectedRow()
          if (row?.entry.kind !== 'directory') return
          if (!row.expanded) state.current.toggle(row.entry.path, true)
          else move(1)()
        },
      },
      {
        id: 'Tree-selectParent',
        isEnabled: inTree,
        perform: () => {
          const row = selectedRow()
          if (!row) return
          if (row.entry.kind === 'directory' && row.expanded && row.depth > 0) {
            state.current.toggle(row.entry.path, false)
            return
          }
          const list = state.current.rows
          const index = list.indexOf(row)
          for (let i = index - 1; i >= 0; i--) {
            if (list[i]!.depth < row.depth) {
              setSelected(list[i]!.entry.path)
              return
            }
          }
        },
      },
      {
        id: 'EditSourceOnEnter',
        isEnabled: inTree,
        perform: () => {
          const row = selectedRow()
          if (row) state.current.activate(row, true)
        },
      },
      {
        id: 'EditSource',
        isEnabled: () => inTree() && selectedRow()?.entry.kind === 'file',
        perform: () => {
          const row = selectedRow()
          if (row) state.current.activate(row, true)
        },
      },
    ]
  }, [])

  return (
    <div
      className="tree"
      tabIndex={0}
      ref={treeRef}
      data-focus-area="tree"
      role="tree"
      aria-label="Project"
      onContextMenu={(event) => {
        // Below the last row: the project root's menu, like IntelliJ.
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        setSelected(project.root)
        const root = rows[0]
        if (root) void openMenu(root, event.clientX, event.clientY)
      }}
    >
      {rows.map((row) => {
        const decoration = row.entry.kind === 'directory' ? decorations.get(row.entry.path) : undefined
        const scratchGroup = row.entry.path === SCRATCH_GROUP
        const icon = scratchGroup
          ? 'fileTypes/scratches'
          : row.entry.kind === 'directory'
            ? row.depth === 0
              ? 'nodes/module'
              : (decoration?.icon ?? 'nodes/folder')
            : fileIconName(row.entry.name)
        const vcsKind = vcs.get(row.entry.path)?.kind
        const isCut = clipboard.mode === 'cut' && clipboard.paths.includes(row.entry.path)
        const nameClass = [vcsKind ? `vcs-${vcsKind}` : '', (decoration?.bold || row.depth === 0) && !scratchGroup ? 'module-root' : ''].filter(Boolean).join(' ')
        return (
        <div
          key={row.entry.path}
          data-path={row.entry.path}
          data-icon={icon}
          role="treeitem"
          aria-expanded={row.entry.kind === 'directory' ? row.expanded : undefined}
          aria-selected={row.entry.path === selected}
          className={`tree-row${row.entry.path === selected ? ' selected' : ''}${isCut ? ' cut' : ''}`}
          style={{ paddingLeft: 4 + row.depth * 18 }}
          onMouseDown={() => setSelected(row.entry.path)}
          onContextMenu={(event) => {
            event.preventDefault()
            setSelected(row.entry.path)
            void openMenu(row, event.clientX, event.clientY)
          }}
          onClick={() => {
            if (row.entry.kind === 'directory') toggle(row.entry.path)
          }}
          onDoubleClick={() => {
            if (row.entry.kind !== 'directory') activate(row, true)
          }}
        >
          <span className="tree-chevron">
            {row.entry.kind === 'directory' && (
              <Icon name={row.expanded ? 'general/chevronDown' : 'general/chevronRight'} size={16} />
            )}
          </span>
          <Icon name={icon} />
          <span className={nameClass || undefined}>{row.entry.name}</span>
          {decoration?.moduleName && <span className="module-name">[{decoration.moduleName}]</span>}
          {row.depth === 0 && !scratchGroup && <span className="hint">{project.root}</span>}
        </div>
        )
      })}
    </div>
  )
}
