import { createStore } from './store'

export type NotificationType = 'error' | 'warning' | 'info'

export interface AppNotification {
  id: number
  type: NotificationType
  title: string
  message: string
  time: number
}

const MAX_NOTIFICATIONS = 100

export const notifications = createStore<{ items: AppNotification[]; unread: number }>({ items: [], unread: 0 })

let counter = 0

export function notify(type: NotificationType, title: string, message: string): void {
  notifications.set((s) => {
    // The same message repeated (e.g. on every import) stays a single entry.
    if (s.items[0]?.title === title && s.items[0].message === message) return {}
    const item: AppNotification = { id: ++counter, type, title, message, time: Date.now() }
    return { items: [item, ...s.items].slice(0, MAX_NOTIFICATIONS), unread: s.unread + 1 }
  })
}

export function markNotificationsRead(): void {
  notifications.set({ unread: 0 })
}

export function clearNotifications(): void {
  notifications.set({ items: [], unread: 0 })
}
