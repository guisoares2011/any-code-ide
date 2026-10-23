import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DirEntry, ProjectInfo } from '@shared/ipc'
import { useActions } from '../keymap/service'
import { openFile, workbench } from '../state/workbench'
import { gitState } from '../state/git'
import { useStore } from '../state/store'
import { Icon } from '../ui/Icon'
import { fileIconName } from '../ui/icons'
import { dirname } from '@shared/paths'
import { sortEntries } from './sortEntries'

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
  const treeRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (dir: string) => {
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
    return result
  }, [project, expanded, children])

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

  const state = useRef({ rows, selected, toggle, activate })
  useLayoutEffect(() => {
    state.current = { rows, selected, toggle, activate }
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
    return [
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
    <div className="tree" tabIndex={0} ref={treeRef} data-focus-area="tree" role="tree" aria-label="Project">
      {rows.map((row) => (
        <div
          key={row.entry.path}
          data-path={row.entry.path}
          role="treeitem"
          aria-expanded={row.entry.kind === 'directory' ? row.expanded : undefined}
          aria-selected={row.entry.path === selected}
          className={`tree-row${row.entry.path === selected ? ' selected' : ''}`}
          style={{ paddingLeft: 4 + row.depth * 18 }}
          onMouseDown={() => setSelected(row.entry.path)}
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
          <Icon name={row.entry.kind === 'directory' ? (row.depth === 0 ? 'nodes/module' : 'nodes/folder') : fileIconName(row.entry.name)} />
          <span className={vcs.get(row.entry.path) ? `vcs-${vcs.get(row.entry.path)!.kind}` : undefined}>{row.entry.name}</span>
          {row.depth === 0 && <span className="hint">{project.root}</span>}
        </div>
      ))}
    </div>
  )
}
