// Line breakpoints (ToggleLineBreakpoint ⌘F8), kept per file and remembered between runs. Running
// debug sessions send a file's breakpoints to their adapter whenever they change.
import { createStore } from '../state/store'

export interface Breakpoint {
  path: string
  /** 1-based line. */
  line: number
  enabled: boolean
  /** Set by the adapter: false when no code is at that line (shown as an invalid breakpoint). */
  verified?: boolean
}

interface BreakpointsState {
  /** Breakpoints of each file, sorted by line. */
  byPath: ReadonlyMap<string, readonly Breakpoint[]>
  /** Mute Breakpoints: the debugger ignores them all. */
  muted: boolean
}

const STORAGE_KEY = 'anycode.breakpoints'

function restore(): ReadonlyMap<string, readonly Breakpoint[]> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as { path: string; line: number; enabled: boolean }[]
    const byPath = new Map<string, Breakpoint[]>()
    for (const { path, line, enabled } of saved) byPath.set(path, [...(byPath.get(path) ?? []), { path, line, enabled }])
    return byPath
  } catch {
    return new Map()
  }
}

export const breakpointState = createStore<BreakpointsState>({ byPath: restore(), muted: false })

const changeListeners = new Set<(path: string) => void>()

/** Called with the file whose breakpoints changed. */
export function onBreakpointsChanged(listener: (path: string) => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function save(): void {
  const all = [...breakpointState.get().byPath.values()].flat().map(({ path, line, enabled }) => ({ path, line, enabled }))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // storage full or unavailable: breakpoints just do not survive a restart
  }
}

function setFile(path: string, list: readonly Breakpoint[], notify = true): void {
  breakpointState.set((s) => {
    const byPath = new Map(s.byPath)
    if (list.length === 0) byPath.delete(path)
    else byPath.set(path, [...list].sort((a, b) => a.line - b.line))
    return { byPath }
  })
  save()
  if (notify) for (const listener of changeListeners) listener(path)
}

export function breakpointsOf(path: string): readonly Breakpoint[] {
  return breakpointState.get().byPath.get(path) ?? []
}

export function allBreakpoints(): Breakpoint[] {
  return [...breakpointState.get().byPath.values()].flat()
}

export function toggleBreakpoint(path: string, line: number): void {
  const list = breakpointsOf(path)
  const existing = list.find((b) => b.line === line)
  setFile(path, existing ? list.filter((b) => b !== existing) : [...list, { path, line, enabled: true }])
}

export function setBreakpointEnabled(path: string, line: number, enabled: boolean): void {
  setFile(
    path,
    breakpointsOf(path).map((b) => (b.line === line ? { ...b, enabled } : b)),
  )
}

export function removeBreakpoint(path: string, line: number): void {
  setFile(
    path,
    breakpointsOf(path).filter((b) => b.line !== line),
  )
}

export function removeAllBreakpoints(): void {
  for (const path of [...breakpointState.get().byPath.keys()]) setFile(path, [])
}

/** Lines moved by edits (the editor tracks them with decorations); sessions get the new lines. */
export function moveBreakpoints(path: string, lines: ReadonlyMap<number, number>): void {
  const list = breakpointsOf(path)
  const moved = list.map((b) => ({ ...b, line: lines.get(b.line) ?? b.line }))
  // Two breakpoints that collapsed onto one line become one.
  const unique = moved.filter((b, i) => moved.findIndex((o) => o.line === b.line) === i)
  if (unique.length !== list.length || unique.some((b, i) => b.line !== list[i]!.line)) setFile(path, unique)
}

/** What the adapter answered for each breakpoint sent; does not resend them. */
export function markVerified(path: string, verified: readonly boolean[]): void {
  const sent = breakpointsOf(path).filter((b) => b.enabled)
  const flags = new Map(sent.map((b, i) => [b.line, verified[i] ?? true]))
  setFile(
    path,
    breakpointsOf(path).map((b) => (flags.has(b.line) ? { ...b, verified: flags.get(b.line) } : b)),
    false,
  )
}

/** Forgets what adapters said once no session runs. */
export function clearVerification(): void {
  for (const [path, list] of breakpointState.get().byPath) {
    setFile(
      path,
      list.map(({ path: p, line, enabled }) => ({ path: p, line, enabled })),
      false,
    )
  }
}

export function setBreakpointsMuted(muted: boolean): void {
  breakpointState.set({ muted })
  for (const path of breakpointState.get().byPath.keys()) for (const listener of changeListeners) listener(path)
}

/** Files and paths moved or renamed: their breakpoints follow. */
export function relocateBreakpoints(from: string, to: string): void {
  for (const [path, list] of [...breakpointState.get().byPath]) {
    if (path !== from && !path.startsWith(`${from}/`)) continue
    const target = to + path.slice(from.length)
    setFile(path, [])
    setFile(
      target,
      list.map((b) => ({ ...b, path: target })),
    )
  }
}
