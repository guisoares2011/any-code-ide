import { useEffect } from 'react'
import { useStore } from '../state/store'
import { clearNotifications, markNotificationsRead, notifications } from '../state/notifications'
import { Icon } from '../ui/Icon'

const ICONS = { error: 'general/errorDialog', warning: 'general/warningDialog', info: 'general/greenCheckmark' } as const

export function NotificationsView({ visible }: { visible: boolean }) {
  const items = useStore(notifications, (s) => s.items)

  useEffect(() => {
    if (visible) markNotificationsRead()
  }, [visible, items])

  if (items.length === 0) return <div className="empty-state">No notifications</div>
  return (
    <div className="notifications" role="list" aria-label="Notifications">
      {items.map((item) => (
        <div key={item.id} className={`notification ${item.type}`} role="listitem">
          <div className="notification-header">
            <Icon name={ICONS[item.type]} />
            <span className="notification-title">{item.title}</span>
            <span className="notification-time">{new Date(item.time).toLocaleTimeString()}</span>
          </div>
          <div className="notification-message">{item.message}</div>
        </div>
      ))}
      <button className="button secondary notifications-clear" onClick={clearNotifications}>
        Clear all
      </button>
    </div>
  )
}
