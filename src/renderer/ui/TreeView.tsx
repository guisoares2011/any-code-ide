import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useActions } from '../keymap/service'
import { Icon } from './Icon'

export interface TreeNode {
  /** Unique within the tree; also the key of the expanded state. */
  id: string
  label: ReactNode
  icon?: string
  hint?: string
  className?: string
  title?: string
  /** Children, or a function computing them when the node is expanded. */
  children?: TreeNode[] | (() => TreeNode[])
  /** Called once when the node is expanded (e.g. to start loading its children). */
  onExpand?(): void
  /** Double click / Enter on a leaf. */
  onActivate?(): void
}

interface Row {
  node: TreeNode
  depth: number
  parent: number
  expandable: boolean
  expanded: boolean
}

/**
 * Expandable tree with IntelliJ keyboard navigation: Tree-* actions (↑ ↓ ← → Home End) and Enter
 * (EditSourceOnEnter) to activate leaves or toggle folders. Keys come from the keymap.
 */
export function TreeView({ nodes, label, initiallyExpanded = [] }: { nodes: TreeNode[]; label: string; initiallyExpanded?: string[] }) {
  const [expanded, setExpanded] = useState(() => new Set(initiallyExpanded))
  const [selected, setSelected] = useState(0)
  const container = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const result: Row[] = []
    const visit = (node: TreeNode, depth: number, parent: number): void => {
      const expandable = node.children !== undefined
      const isOpen = expandable && expanded.has(node.id)
      const index = result.length
      result.push({ node, depth, parent, expandable, expanded: isOpen })
      if (isOpen) {
        const children = typeof node.children === 'function' ? node.children() : (node.children ?? [])
        for (const child of children) visit(child, depth + 1, index)
      }
    }
    for (const node of nodes) visit(node, 0, -1)
    return result
  }, [nodes, expanded])

  const toggle = (row: Row, open?: boolean): void => {
    if (!row.expandable) return
    const shouldOpen = open ?? !row.expanded
    if (shouldOpen && !row.expanded) row.node.onExpand?.()
    setExpanded((prev) => {
      const next = new Set(prev)
      if (shouldOpen) next.add(row.node.id)
      else next.delete(row.node.id)
      return next
    })
  }

  const activate = (row: Row): void => {
    if (row.node.onActivate) row.node.onActivate()
    else toggle(row)
  }

  useEffect(() => {
    container.current?.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const state = useRef({ rows, selected, toggle, activate })
  useLayoutEffect(() => {
    state.current = { rows, selected, toggle, activate }
  })

  useActions(() => {
    const inside = (): boolean => container.current?.contains(document.activeElement) ?? false
    const move = (to: (i: number, n: number) => number) => () => {
      const n = state.current.rows.length
      if (n > 0) setSelected(Math.min(Math.max(to(state.current.selected, n), 0), n - 1))
    }
    const current = (): Row | undefined => state.current.rows[state.current.selected]
    return [
      { id: 'Tree-selectNext', isEnabled: inside, perform: move((i) => i + 1) },
      { id: 'Tree-selectPrevious', isEnabled: inside, perform: move((i) => i - 1) },
      { id: 'Tree-selectFirst', isEnabled: inside, perform: move(() => 0) },
      { id: 'Tree-selectLast', isEnabled: inside, perform: move((_, n) => n - 1) },
      {
        id: 'Tree-selectChild',
        isEnabled: inside,
        perform: () => {
          const row = current()
          if (!row?.expandable) return
          if (!row.expanded) state.current.toggle(row, true)
          else move((i) => i + 1)()
        },
      },
      {
        id: 'Tree-selectParent',
        isEnabled: inside,
        perform: () => {
          const row = current()
          if (!row) return
          if (row.expanded) state.current.toggle(row, false)
          else if (row.parent >= 0) setSelected(row.parent)
        },
      },
      {
        id: 'EditSourceOnEnter',
        isEnabled: inside,
        perform: () => {
          const row = current()
          if (row) state.current.activate(row)
        },
      },
    ]
  }, [])

  return (
    <div className="tree" tabIndex={0} ref={container} data-focus-area="tree" role="tree" aria-label={label}>
      {rows.map((row, index) => (
        <div
          key={`${row.node.id}:${index}`}
          role="treeitem"
          aria-expanded={row.expandable ? row.expanded : undefined}
          aria-selected={index === selected}
          title={row.node.title}
          className={`tree-row${index === selected ? ' selected' : ''}`}
          style={{ paddingLeft: 4 + row.depth * 18 }}
          onMouseDown={() => setSelected(index)}
          onClick={() => {
            if (row.expandable && !row.node.onActivate) toggle(row)
          }}
          onDoubleClick={() => {
            if (row.node.onActivate) row.node.onActivate()
          }}
        >
          <span
            className="tree-chevron"
            onClick={(e) => {
              e.stopPropagation()
              toggle(row)
            }}
          >
            {row.expandable && <Icon name={row.expanded ? 'general/chevronDown' : 'general/chevronRight'} size={16} />}
          </span>
          {row.node.icon && <Icon name={row.node.icon} />}
          <span className={row.node.className}>{row.node.label}</span>
          {row.node.hint && <span className="hint">{row.node.hint}</span>}
        </div>
      ))}
    </div>
  )
}
