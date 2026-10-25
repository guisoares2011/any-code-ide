// Debug sessions of the window, the one the Debug tool window shows, and the execution point the
// editor highlights (the selected frame of the active session).
import { createStore } from '../state/store'
import { workbench } from '../state/workbench'
import { clearVerification } from './breakpoints'
import type { DebugSession } from './session'

export const debugState = createStore<{ sessions: readonly DebugSession[]; active: string | null }>({ sessions: [], active: null })

export interface ExecutionPoint {
  path: string
  line: number
  /** The top frame (the line about to run) or a caller selected in Frames. */
  top: boolean
}

export const executionPoint = createStore<{ point: ExecutionPoint | null; seq: number }>({ point: null, seq: 0 })

/** Sessions of the project shown in the window. */
export function projectSessions(): DebugSession[] {
  const root = workbench.get().project?.root
  return debugState.get().sessions.filter((s) => s.root === root)
}

/** The session the Debug tool window shows for the current project. */
export function activeSession(): DebugSession | undefined {
  const sessions = projectSessions()
  return sessions.find((s) => s.id === debugState.get().active) ?? sessions.at(-1)
}

function updateExecutionPoint(): void {
  const session = activeSession()
  const frame = session?.paused ? session.selectedFrame() : undefined
  const path = frame?.source?.path
  const point = path && frame ? { path, line: frame.line, top: frame.id === session?.state.frames[0]?.id } : null
  const current = executionPoint.get().point
  if (point?.path === current?.path && point?.line === current?.line && point?.top === current?.top) return
  executionPoint.set((s) => ({ point, seq: s.seq + 1 }))
}

export function addSession(session: DebugSession): void {
  debugState.set((s) => ({ sessions: [...s.sessions, session], active: session.id }))
  session.store.subscribe(updateExecutionPoint)
  session.onEnd(() => {
    updateExecutionPoint()
    if (!debugState.get().sessions.some((s) => s.active)) clearVerification()
  })
}

export function activateSession(id: string): void {
  debugState.set({ active: id })
  updateExecutionPoint()
}

/** Closing a session tab forgets it (its console closes with it). */
export function removeSession(id: string): void {
  debugState.set((s) => ({
    sessions: s.sessions.filter((session) => session.id !== id),
    active: s.active === id ? null : s.active,
  }))
  updateExecutionPoint()
}

workbench.subscribe(() => {
  // Switching project tabs shows that project's session.
  updateExecutionPoint()
})
