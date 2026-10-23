// Fuzzy matching in the spirit of IntelliJ's MinusculeMatcher: pattern characters must appear in
// order; matches at word starts (camelCase humps, after separators) and contiguous runs score
// higher, and a "/" in the pattern lets users narrow by directory.

export interface FuzzyMatch {
  score: number
  /** Indices in the candidate that matched, for highlighting. */
  positions: number[]
}

const SEPARATORS = new Set(['/', '\\', '.', '-', '_', ' ', ':'])

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true
  const prev = text[index - 1]!
  const ch = text[index]!
  if (SEPARATORS.has(prev)) return true
  return ch !== ch.toLowerCase() && prev === prev.toLowerCase() && /[a-z0-9]/i.test(prev)
}

export function fuzzyMatch(pattern: string, candidate: string): FuzzyMatch | null {
  const query = pattern.replace(/\s+/g, '')
  if (query === '') return { score: 0, positions: [] }
  const lowerCandidate = candidate.toLowerCase()
  const lowerQuery = query.toLowerCase()

  // Greedy-with-preference: for each pattern char take the next word start if one is reachable
  // before the plain next occurrence breaks order; otherwise the next occurrence.
  const positions: number[] = []
  let from = 0
  for (let q = 0; q < lowerQuery.length; q++) {
    const ch = lowerQuery[q]!
    let found = -1
    const contiguous = positions.length > 0 && lowerCandidate[from] === ch ? from : -1
    if (contiguous >= 0) found = contiguous
    else {
      for (let i = from; i < lowerCandidate.length; i++) {
        if (lowerCandidate[i] === ch && isWordStart(candidate, i)) {
          found = i
          break
        }
      }
      if (found < 0) found = lowerCandidate.indexOf(ch, from)
    }
    if (found < 0) return null
    positions.push(found)
    from = found + 1
  }

  let score = 0
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!
    if (isWordStart(candidate, pos)) score += 10
    if (i > 0 && positions[i - 1] === pos - 1) score += 6
    if (candidate[pos] === query[i]) score += 1
  }
  // Prefer matches in the file name (after the last "/"), then shorter candidates.
  const nameStart = candidate.lastIndexOf('/') + 1
  score += positions.filter((p) => p >= nameStart).length * 4
  if (lowerCandidate.slice(nameStart).startsWith(lowerQuery)) score += 30
  score -= candidate.length * 0.05
  return { score, positions }
}

/** Ranks candidates by score, keeping the original order for ties; drops non-matches. */
export function rank<T>(pattern: string, items: readonly T[], text: (item: T) => string, limit = 200) {
  const scored: { item: T; match: FuzzyMatch; index: number }[] = []
  items.forEach((item, index) => {
    const match = fuzzyMatch(pattern, text(item))
    if (match) scored.push({ item, match, index })
  })
  scored.sort((a, b) => b.match.score - a.match.score || a.index - b.index)
  return scored.slice(0, limit)
}
