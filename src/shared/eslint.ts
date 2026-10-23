// ESLint diagnostics from the project's own ESLint (run in a separate process by the main).

export interface LintProblem {
  /** 1-based positions, as ESLint reports them. */
  line: number
  column: number
  endLine: number
  endColumn: number
  severity: 'error' | 'warning'
  message: string
  ruleId: string | null
}

/** unavailable: the project has no ESLint or no configuration; nothing to show, nothing to report. */
export type LintResult =
  | { status: 'ok'; problems: LintProblem[] }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string }

/** `output` is the fixed text, or null when no fix applies. */
export type FixResult = { status: 'ok'; output: string | null } | { status: 'unavailable'; reason: string } | { status: 'error'; message: string }
