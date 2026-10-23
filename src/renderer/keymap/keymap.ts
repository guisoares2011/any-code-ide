// Shortcut resolution with IntelliJ semantics (intellij-community KeymapImpl, MacOSDefaultKeymap):
//   own[id] -> own[binding(id)] -> parent resolution, where a "Mac OS X*" keymap converts every
//   inherited shortcut with the control <-> meta swap. An own entry, even empty, replaces the
//   parent's shortcuts. Plugin operations apply after the XML, like KeymapImpl.doInitShortcuts.
import type { KeymapDefinition, KeymapOperation } from './keymapXml'
import { convertFromParent, sameShortcut, type Shortcut } from './shortcut'

export type ActionBinding = (actionId: string) => string | undefined

export class Keymap {
  private readonly own: Map<string, Shortcut[]>

  constructor(
    readonly name: string,
    readonly parent: Keymap | null,
    own: ReadonlyMap<string, Shortcut[]>,
    private readonly binding: ActionBinding = () => undefined,
  ) {
    this.own = new Map(own)
  }

  static fromDefinition(definition: KeymapDefinition, parent: Keymap | null, binding?: ActionBinding): Keymap {
    if ((definition.parent ?? null) !== (parent?.name ?? null)) {
      throw new Error(`Keymap "${definition.name}" expects parent "${definition.parent}", got "${parent?.name}"`)
    }
    return new Keymap(definition.name, parent, definition.actions, binding)
  }

  /** MacOSDefaultKeymap is used for every bundled keymap whose name starts with "Mac OS X". */
  private get convertsParentShortcuts(): boolean {
    return this.name.startsWith('Mac OS X')
  }

  getShortcuts(actionId: string): Shortcut[] {
    return this.lookup(actionId, this.binding)
  }

  // Bindings come from action declarations (ActionManager), so the child's binding applies at every level.
  private lookup(actionId: string, binding: ActionBinding): Shortcut[] {
    const own = this.own.get(actionId)
    if (own) return own
    const bound = binding(actionId)
    const ownBound = bound === undefined ? undefined : this.own.get(bound)
    if (ownBound) return ownBound
    return this.parentShortcuts(actionId, binding)
  }

  private parentShortcuts(actionId: string, binding: ActionBinding = this.binding): Shortcut[] {
    if (!this.parent) return []
    const inherited = this.parent.lookup(actionId, binding)
    return this.convertsParentShortcuts ? inherited.map(convertFromParent) : inherited
  }

  /** Action ids with own shortcuts here or in any parent. */
  actionIds(): Set<string> {
    const ids = new Set(this.parent?.actionIds() ?? [])
    for (const id of this.own.keys()) ids.add(id)
    return ids
  }

  apply(operations: readonly KeymapOperation[]): void {
    for (const operation of operations) {
      switch (operation.kind) {
        case 'add': {
          const current = this.ownOrInherited(operation.actionId)
          if (!current.some((s) => sameShortcut(s, operation.shortcut))) current.push(operation.shortcut)
          this.own.set(operation.actionId, current)
          break
        }
        case 'remove': {
          const current = this.ownOrInherited(operation.actionId)
          this.own.set(
            operation.actionId,
            current.filter((s) => !sameShortcut(s, operation.shortcut)),
          )
          break
        }
        case 'removeAll':
          this.own.set(operation.actionId, [])
          break
      }
    }
  }

  /** Mutable copy of the list doAddShortcut/doRemoveShortcut start from. */
  private ownOrInherited(actionId: string): Shortcut[] {
    const own = this.own.get(actionId)
    if (own) return [...own]
    const bound = this.binding(actionId)
    const ownBound = bound === undefined ? undefined : this.own.get(bound)
    return [...(ownBound ?? this.parentShortcuts(actionId))]
  }
}
