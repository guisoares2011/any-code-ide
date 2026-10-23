import { useRef } from 'react'

interface SplitterProps {
  orientation: 'vertical' | 'horizontal'
  /** Current size of the panel being resized. */
  size: number
  /** +1 when dragging right/down grows the panel, -1 when it shrinks it. */
  direction: 1 | -1
  min: number
  max: number
  onResize(size: number): void
}

export function Splitter({ orientation, size, direction, min, max, onResize }: SplitterProps) {
  const drag = useRef<{ start: number; size: number } | null>(null)
  return (
    <div
      className={`splitter ${orientation}`}
      role="separator"
      aria-orientation={orientation}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { start: orientation === 'vertical' ? event.clientX : event.clientY, size }
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        const position = orientation === 'vertical' ? event.clientX : event.clientY
        const next = drag.current.size + direction * (position - drag.current.start)
        onResize(Math.min(Math.max(next, min), max))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    />
  )
}
