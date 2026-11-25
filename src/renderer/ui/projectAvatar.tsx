import type { CSSProperties } from 'react'

/** Islands Dark has nine avatar gradients (RecentProject.Color1…9.Avatar.Start/End). */
const AVATAR_COLORS = 9

/** Up to two letters, from the first words of the name: "admin-bff" → AB, "CodingPlataform" → CP. */
export function projectInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+|(?=\p{Lu}\p{Ll})/u).filter((w) => /^\p{L}/u.test(w))
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** A stable gradient per project path, 1…9. */
export function projectColorIndex(path: string): number {
  let hash = 0
  for (const ch of path) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0
  return (Math.abs(hash) % AVATAR_COLORS) + 1
}

/** The project's square with its initials, as in the toolbar and on the Welcome screen. */
export function ProjectAvatar({ name, path, size = 20 }: { name: string; path: string; size?: number }) {
  const color = projectColorIndex(path)
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size / 2),
    '--avatar-start': `var(--ui-RecentProject-Color${color}-Avatar-Start)`,
    '--avatar-end': `var(--ui-RecentProject-Color${color}-Avatar-End)`,
  } as CSSProperties
  return (
    <span className="project-avatar" style={style} aria-hidden>
      {projectInitials(name)}
    </span>
  )
}
