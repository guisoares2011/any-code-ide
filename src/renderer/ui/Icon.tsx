import { iconUrl } from './icons'

interface IconProps {
  name: string
  size?: number
  className?: string
  title?: string
}

export function Icon({ name, size = 16, className, title }: IconProps) {
  const url = iconUrl(name)
  if (!url) return <span className={className} style={{ width: size, height: size, display: 'inline-block' }} />
  return <img src={url} width={size} height={size} className={className} alt={title ?? ''} draggable={false} />
}
