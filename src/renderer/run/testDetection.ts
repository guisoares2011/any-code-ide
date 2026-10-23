// JUnit tests in Java/Kotlin sources, found by reading the text (no compiler): what IntelliJ marks
// with run gutter icons. Good enough for the usual shapes; nested classes count as their outer class.

export interface TestMethod {
  name: string
  /** 1-based line of the declaration. */
  line: number
}

export interface TestClass {
  /** Fully qualified name. */
  className: string
  line: number
  methods: TestMethod[]
}

export interface TestFile {
  packageName: string
  classes: TestClass[]
}

/** JUnit 4/5 annotations that make a method a test (simple or qualified name). */
const TEST_ANNOTATION = /@(?:[\w.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/
const CLASS_DECLARATION = /\b(?:class|object)\s+(\w+)/
const KOTLIN_FUNCTION = /\bfun\s+(?:<[^>]*>\s*)?(?:`([^`]+)`|(\w+))\s*\(/
const JAVA_METHOD = /(\w+)\s*\(/
const JAVA_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'synchronized'])

/** Removes string literals and comments so braces and keywords inside them do not count. */
function code(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\/\/.*$/, '')
}

export function findTests(source: string): TestFile {
  const packageName = /^\s*package\s+([\w.]+)/m.exec(source)?.[1] ?? ''
  const qualify = (name: string): string => (packageName ? `${packageName}.${name}` : name)
  const classes: TestClass[] = []
  let depth = 0
  let inComment = false
  let pendingTest = false
  let current: TestClass | null = null

  source.split('\n').forEach((raw, index) => {
    let line = raw
    if (inComment) {
      const end = line.indexOf('*/')
      if (end < 0) return
      line = line.slice(end + 2)
      inComment = false
    }
    line = code(line).replace(/\/\*.*?\*\//g, '')
    const open = line.indexOf('/*')
    if (open >= 0) {
      line = line.slice(0, open)
      inComment = true
    }

    const classMatch = CLASS_DECLARATION.exec(line)
    if (classMatch && depth === 0) {
      current = { className: qualify(classMatch[1]!), line: index + 1, methods: [] }
      classes.push(current)
    }
    if (TEST_ANNOTATION.test(line)) pendingTest = true
    // The declaration may follow the annotation on the same line or on a later one.
    const rest = line.replace(TEST_ANNOTATION, '').replace(/@[\w.]+(\([^)]*\))?/g, '')
    if (pendingTest && current) {
      const kotlin = KOTLIN_FUNCTION.exec(rest)
      const java = kotlin ? null : JAVA_METHOD.exec(rest)
      const name = kotlin ? (kotlin[1] ?? kotlin[2]) : java && !JAVA_KEYWORDS.has(java[1]!) ? java[1] : undefined
      if (name) {
        current.methods.push({ name, line: index + 1 })
        pendingTest = false
      }
    }
    for (const ch of line) {
      if (ch === '{') depth++
      else if (ch === '}') depth = Math.max(depth - 1, 0)
    }
  })
  return { packageName, classes: classes.filter((c) => c.methods.length > 0) }
}

/**
 * Build module directory of a test source, relative to the project root: the part before
 * `src/test/` (Maven and Gradle layouts), "" for the root module.
 */
export function moduleOfTestFile(root: string, path: string): string {
  const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  const index = relative.indexOf('src/test/')
  return index > 0 ? relative.slice(0, index - 1) : ''
}
