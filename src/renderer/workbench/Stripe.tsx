import { performAction, shortcutFor } from '../keymap/service'
import { notifications } from '../state/notifications'
import { useStore } from '../state/store'
import { workbench, TOOL_WINDOWS, type ToolWindowSpec } from '../state/workbench'
import { Icon } from '../ui/Icon'

function StripeButton({ spec }: { spec: ToolWindowSpec }) {
  const visible = useStore(workbench, (s) => s.visible[spec.anchor] === spec.id)
  const shortcut = shortcutFor(spec.activateActionId)
  const unread = useStore(notifications, (s) => (spec.id === 'Notifications' ? s.unread : 0))
  return (
    <button
      className={`stripe-button${visible ? ' selected' : ''}`}
      title={shortcut ? `${spec.title} ${shortcut}` : spec.title}
      aria-pressed={visible}
      onClick={() => performAction(spec.activateActionId)}
    >
      <Icon name={spec.icon} size={20} />
      {unread > 0 && !visible && <span className="stripe-badge" aria-label={`${unread} unread`} />}
    </button>
  )
}

/** New UI stripes: the left one holds left tool windows on top and bottom ones below. */
export function Stripe({ side }: { side: 'left' | 'right' }) {
  const top = TOOL_WINDOWS.filter((t) => t.anchor === side)
  const bottom = side === 'left' ? TOOL_WINDOWS.filter((t) => t.anchor === 'bottom') : []
  return (
    <div className="stripe" data-side={side}>
      <div className="stripe-group">
        {top.map((spec) => (
          <StripeButton key={spec.id} spec={spec} />
        ))}
      </div>
      <div className="stripe-spacer" />
      <div className="stripe-group">
        {bottom.map((spec) => (
          <StripeButton key={spec.id} spec={spec} />
        ))}
      </div>
    </div>
  )
}
