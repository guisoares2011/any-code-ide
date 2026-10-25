import { useEffect, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react'
import { actionLabel, actions, currentFocusArea, shortcutFor, useActions } from '../keymap/service'
import { createStore, useStore } from '../state/store'
import { Icon } from './Icon'

export interface MenuAction {
  label: string
  icon?: string
  /** Shown on the right; defaults to the keymap shortcut of `actionId`. */
  shortcut?: string
  /** The IntelliJ action this item stands for (shortcut hint). */
  actionId?: string
  disabled?: boolean
  run?(): void
  children?: MenuItem[]
}

export type MenuItem = MenuAction | 'separator'

/** A menu item for a registered action: its text, shortcut and enabled state come from the registry. */
export function actionItem(actionId: string, overrides: Partial<MenuAction> = {}): MenuAction {
  const action = actions.get(actionId)
  const context = { focusArea: currentFocusArea() }
  return {
    label: action ? actionLabel(action) : actionId,
    actionId,
    disabled: !actions.isEnabled(actionId, context),
    run: () => actions.perform(actionId, context),
    ...overrides,
  }
}

interface OpenMenu {
  x: number
  y: number
  items: MenuItem[]
  /** Focus goes back here when the menu closes. */
  returnFocus: HTMLElement | null
}

const menuState = createStore<{ menu: OpenMenu | null }>({ menu: null })

/** Shows a context menu at a point (a right click, or below the selected row for the keyboard). */
export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  const cleaned = items.filter((item, i, all) => item !== 'separator' || (i > 0 && i < all.length - 1 && all[i - 1] !== 'separator'))
  if (cleaned.length === 0) return
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  menuState.set({ menu: { x, y, items: cleaned, returnFocus } })
}

export function closeContextMenu(): void {
  const menu = menuState.get().menu
  menuState.set({ menu: null })
  menu?.returnFocus?.focus()
}

export const isContextMenuOpen = (): boolean => menuState.get().menu !== null

const mnemonicFree = (label: string): string => label.replace(/_(?=\S)/, '')

export function ContextMenuHost() {
  const menu = useStore(menuState, (s) => s.menu)
  return menu ? <ContextMenu key={`${menu.x}:${menu.y}`} menu={menu} /> : null
}

function ContextMenu({ menu }: { menu: OpenMenu }) {
  // The open chain of menus: [root, submenu, ...], each with its selected index.
  const [path, setPath] = useState<{ items: MenuItem[]; selected: number }[]>([{ items: menu.items, selected: -1 }])
  const rootRef = useRef<HTMLDivElement>(null)
  const state = useRef(path)
  useLayoutEffect(() => {
    state.current = path
  })

  useEffect(() => rootRef.current?.focus(), [])

  const run = (item: MenuAction): void => {
    if (item.disabled || item.children) return
    closeContextMenu()
    item.run?.()
  }

  useActions(() => {
    const inMenu = (): boolean => isContextMenuOpen()
    const enabled = (items: MenuItem[]): number[] => items.flatMap((item, i) => (item !== 'separator' && !item.disabled ? [i] : []))
    const move = (delta: 1 | -1) => () =>
      setPath((chain) => {
        const last = chain.at(-1)!
        const indices = enabled(last.items)
        if (indices.length === 0) return chain
        const position = indices.indexOf(last.selected)
        const next = position < 0 ? (delta > 0 ? indices[0]! : indices.at(-1)!) : indices[(position + delta + indices.length) % indices.length]!
        return [...chain.slice(0, -1), { ...last, selected: next }]
      })
    const current = (): MenuAction | undefined => {
      const last = state.current.at(-1)!
      const item = last.items[last.selected]
      return item && item !== 'separator' ? item : undefined
    }
    const openChild = (): void => {
      const item = current()
      if (item?.children && !item.disabled) {
        const first = enabled(item.children)[0] ?? -1
        setPath((chain) => [...chain, { items: item.children!, selected: first }])
      }
    }
    return [
      { id: 'List-selectNextRow', isEnabled: inMenu, perform: move(1) },
      { id: 'List-selectPreviousRow', isEnabled: inMenu, perform: move(-1) },
      { id: 'List-selectNextColumn', isEnabled: inMenu, perform: openChild },
      { id: 'List-selectPreviousColumn', isEnabled: () => inMenu() && state.current.length > 1, perform: () => setPath((chain) => chain.slice(0, -1)) },
      {
        id: 'Popup.Confirm',
        isEnabled: inMenu,
        perform: () => {
          const item = current()
          if (item?.children) openChild()
          else if (item) run(item)
        },
      },
      {
        id: 'Popup.Cancel',
        isEnabled: inMenu,
        perform: () => (state.current.length > 1 ? setPath((chain) => chain.slice(0, -1)) : closeContextMenu()),
      },
    ]
  }, [])

  return (
    <div className="context-menu-backdrop" onMouseDown={closeContextMenu} onContextMenu={(e) => e.preventDefault()}>
      {path.map((level, depth) => (
        <MenuPanel
          key={depth}
          ref={depth === 0 ? rootRef : undefined}
          items={level.items}
          selected={level.selected}
          anchor={depth === 0 ? { x: menu.x, y: menu.y } : null}
          depth={depth}
          onHover={(index) => {
            const item = level.items[index]
            setPath((chain) => {
              const kept = chain.slice(0, depth + 1).map((l, i) => (i === depth ? { ...l, selected: index } : l))
              if (item && item !== 'separator' && item.children && !item.disabled) kept.push({ items: item.children, selected: -1 })
              return kept
            })
          }}
          onRun={run}
        />
      ))}
    </div>
  )
}

interface PanelProps {
  items: MenuItem[]
  selected: number
  /** Position of the root menu; submenus open beside their parent's selected row. */
  anchor: { x: number; y: number } | null
  depth: number
  onHover(index: number): void
  onRun(item: MenuAction): void
  ref?: Ref<HTMLDivElement>
}

function MenuPanel({ items, selected, anchor, depth, onHover, onRun, ref }: PanelProps) {
  const panel = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Keep the menu on screen, and put submenus next to the row that opened them.
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    let left: number
    let top: number
    if (anchor) {
      left = anchor.x
      top = anchor.y
    } else {
      const parents = document.querySelectorAll<HTMLElement>('.context-menu')
      const parent = parents[depth - 1]
      const row = parent?.querySelector<HTMLElement>('.context-menu-item.selected')
      const parentBox = parent?.getBoundingClientRect()
      const rowBox = row?.getBoundingClientRect()
      left = (parentBox?.right ?? 0) - 4
      top = (rowBox?.top ?? parentBox?.top ?? 0) - 5
      if (left + width > window.innerWidth - 4) left = (parentBox?.left ?? 0) - width + 4
    }
    left = Math.max(4, Math.min(left, window.innerWidth - width - 4))
    top = Math.max(4, Math.min(top, window.innerHeight - height - 4))
    setPosition({ left, top })
  }, [anchor, depth])

  return (
    <div
      ref={(element) => {
        panel.current = element
        if (typeof ref === 'function') ref(element)
        else if (ref) (ref as RefObject<HTMLDivElement | null>).current = element
      }}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      data-focus-area="popup"
      // Transparent rather than hidden while it is measured: hidden elements cannot take focus.
      style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, opacity: 0 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={index} className="context-menu-separator" role="separator" />
        ) : (
          <div
            key={index}
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.children ? 'menu' : undefined}
            className={`context-menu-item${index === selected ? ' selected' : ''}${item.disabled ? ' disabled' : ''}`}
            onMouseEnter={() => onHover(index)}
            onClick={() => onRun(item)}
          >
            <span className="context-menu-icon">{item.icon && <Icon name={item.icon} />}</span>
            <span className="context-menu-label">{mnemonicFree(item.label)}</span>
            {item.children ? (
              <Icon name="general/chevronRight" size={14} />
            ) : (
              <span className="shortcut">{item.shortcut ?? (item.actionId ? shortcutFor(item.actionId) : undefined)}</span>
            )}
          </div>
        ),
      )}
    </div>
  )
}
