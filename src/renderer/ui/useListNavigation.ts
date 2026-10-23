import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useActions } from '../keymap/service'

/**
 * Keyboard navigation for a flat list rendered as a tree (Problems, Structure): the Tree-* actions
 * and Enter, enabled while focus is inside `container`. Keys come from the keymap like everywhere else.
 */
export function useListNavigation<T>(
  container: RefObject<HTMLElement | null>,
  items: readonly T[],
  selected: number,
  setSelected: (index: number) => void,
  activate: (item: T) => void,
): void {
  const state = useRef({ items, selected, setSelected, activate })
  useLayoutEffect(() => {
    state.current = { items, selected, setSelected, activate }
  })

  useActions(() => {
    const inside = (): boolean => container.current?.contains(document.activeElement) ?? false
    const move = (to: (current: number, count: number) => number) => () => {
      const { items: list, selected: current, setSelected: select } = state.current
      if (list.length > 0) select(Math.min(Math.max(to(current, list.length), 0), list.length - 1))
    }
    return [
      { id: 'Tree-selectNext', isEnabled: inside, perform: move((i) => i + 1) },
      { id: 'Tree-selectPrevious', isEnabled: inside, perform: move((i) => i - 1) },
      { id: 'Tree-selectFirst', isEnabled: inside, perform: move(() => 0) },
      { id: 'Tree-selectLast', isEnabled: inside, perform: move((_, n) => n - 1) },
      {
        id: 'EditSourceOnEnter',
        isEnabled: inside,
        perform: () => {
          const item = state.current.items[state.current.selected]
          if (item !== undefined) state.current.activate(item)
        },
      },
    ]
  }, [])
}
