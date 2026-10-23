// Action registry keyed by IntelliJ action ids. Components register actions here; the keymap
// dispatcher is the only place that turns key events into actions. Several components may
// register the same id (NextTab in the editor and in the terminal): the most recent enabled
// handler runs, like IntelliJ's context-dependent action handlers.

/** Where keyboard focus is; set with data-focus-area on a container element. */
export type FocusArea = 'editor' | 'terminal' | 'run' | 'tree' | 'popup' | 'other'

export interface ActionContext {
  focusArea: FocusArea
}

export interface ActionDefinition {
  /** IntelliJ action id, e.g. "GotoFile". */
  id: string
  /** Presentation text; defaults to ActionsBundle (see actionTexts.ts). */
  text?: string
  perform(context: ActionContext): void
  isEnabled?(context: ActionContext): boolean
  /** use-shortcut-of: reuse another action's shortcuts. */
  useShortcutOf?: string
}

type Listener = () => void

export class ActionRegistry {
  private readonly handlers = new Map<string, ActionDefinition[]>()
  private readonly listeners = new Set<Listener>()
  private versionValue = 0

  /** Registers a handler for an action id; returns the unregister function. */
  register(action: ActionDefinition): () => void {
    this.handlers.set(action.id, [action, ...(this.handlers.get(action.id) ?? [])])
    this.changed()
    return () => {
      const remaining = (this.handlers.get(action.id) ?? []).filter((h) => h !== action)
      if (remaining.length > 0) this.handlers.set(action.id, remaining)
      else this.handlers.delete(action.id)
      this.changed()
    }
  }

  /** The most recently registered handler of an id. */
  get(id: string): ActionDefinition | undefined {
    return this.handlers.get(id)?.[0]
  }

  /** One definition per registered id. */
  all(): ActionDefinition[] {
    return [...this.handlers.values()].map((list) => list[0]!)
  }

  isEnabled(id: string, context: ActionContext): boolean {
    return this.enabledHandler(id, context) !== undefined
  }

  /** Performs the first enabled handler; returns whether one ran. */
  perform(id: string, context: ActionContext): boolean {
    const handler = this.enabledHandler(id, context)
    if (!handler) return false
    handler.perform(context)
    return true
  }

  binding(id: string): string | undefined {
    return this.handlers.get(id)?.find((h) => h.useShortcutOf)?.useShortcutOf
  }

  get version(): number {
    return this.versionValue
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private enabledHandler(id: string, context: ActionContext): ActionDefinition | undefined {
    return this.handlers.get(id)?.find((h) => h.isEnabled?.(context) ?? true)
  }

  private changed(): void {
    this.versionValue++
    for (const listener of this.listeners) listener()
  }
}
