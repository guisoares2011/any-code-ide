import type { AnyCodeBridge } from '../shared/ipc'

declare global {
  interface Window {
    anycode: AnyCodeBridge
  }
}

export {}
