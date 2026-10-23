// Path helpers that work on POSIX-style absolute paths without touching the filesystem.

/** Normalizes "." and ".." segments and duplicate slashes of an absolute POSIX path. */
export function normalizePath(path: string): string {
  const parts: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return '/' + parts.join('/')
}

/** True when `target` is `root` itself or lies below it, after normalization. */
export function isInside(root: string, target: string): boolean {
  const r = normalizePath(root)
  const t = normalizePath(target)
  return t === r || t.startsWith(r === '/' ? '/' : r + '/')
}

export function basename(path: string): string {
  const normalized = normalizePath(path)
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function dirname(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}

export function extname(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index)
}

/** Path of `target` relative to `root`; `target` itself when it is outside `root`. */
export function relativePath(root: string, target: string): string {
  const r = normalizePath(root)
  const t = normalizePath(target)
  if (t === r) return ''
  return isInside(r, t) ? t.slice(r === '/' ? 1 : r.length + 1) : t
}
