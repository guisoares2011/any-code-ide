// Resolved dependencies through `dependency:tree`, which writes one tree per reactor module to a file.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MavenDependenciesResult, MavenDependency } from '@shared/maven'
import { shellQuote } from '../pty'
import { mavenCommand } from './pom'

let mvnOnPath: Promise<boolean> | null = null

/** Whether the user's login shell finds `mvn` (checked once). */
export function hasMvnOnPath(shell: string): Promise<boolean> {
  mvnOnPath ??= new Promise((resolve) => execFile(shell, ['-l', '-c', 'command -v mvn'], (error) => resolve(!error)))
  return mvnOnPath
}

const TIMEOUT_MS = 5 * 60_000
/**
 * Pinned so the result does not depend on the Maven version's default plugin (3.9.4 defaults to
 * 3.6.0); Maven downloads it once if the local repository lacks it.
 */
export const DEPENDENCY_PLUGIN = 'org.apache.maven.plugins:maven-dependency-plugin:3.8.1'

/** Parses one coordinate line: group:artifact:type[:classifier]:version[:scope] [(optional)]. */
export function parseCoordinate(line: string): MavenDependency | null {
  const optional = / \(optional\)/.test(line)
  const clean = line.replace(/ \(.*\)\s*$/, '').trim()
  const parts = clean.split(':')
  if (parts.length < 4) return null
  const [groupId, artifactId, type] = parts as [string, string, string]
  let version: string
  let scope = ''
  if (parts.length === 4) version = parts[3]!
  else if (parts.length === 5) {
    version = parts[3]!
    scope = parts[4]!
  } else {
    // with classifier: group:artifact:type:classifier:version:scope
    version = parts[4]!
    scope = parts[5] ?? ''
  }
  return { groupId, artifactId, type, version, scope, optional, children: [] }
}

/** Parses the text output of dependency:tree (several modules concatenated with appendOutput). */
export function parseDependencyTrees(output: string): MavenDependency[] {
  const roots: MavenDependency[] = []
  const stack: MavenDependency[] = []
  for (const raw of output.split('\n')) {
    const line = raw.trimEnd()
    if (!line) continue
    // Children start with "|  " / "   " per level, then "+- " or "\- "; module roots have no prefix.
    const branch = /^([| ]{3})*[+\\]- /.exec(line)
    const node = parseCoordinate(branch ? line.slice(branch[0].length) : line)
    if (!node) continue
    if (!branch) {
      roots.push(node)
      stack.length = 0
      stack.push(node)
      continue
    }
    const depth = (branch[0].length - 3) / 3 + 1
    stack.length = depth
    const parent = stack[depth - 1]
    if (!parent) continue
    parent.children.push(node)
    stack.push(node)
  }
  return roots
}

export async function resolveDependencies(root: string, shell: string): Promise<MavenDependenciesResult> {
  const dir = await mkdtemp(join(tmpdir(), 'anycode-deptree-'))
  const out = join(dir, 'tree.txt')
  const maven = mavenCommand(root, await hasMvnOnPath(shell))
  const script = `${shellQuote(maven)} -B -q ${DEPENDENCY_PLUGIN}:tree -DoutputType=text -DappendOutput=true -DoutputFile=${shellQuote(out)}`
  try {
    const result = await new Promise<{ ok: boolean; output: string }>((resolve) => {
      execFile(shell, ['-l', '-c', script], { cwd: root, timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) =>
        resolve({ ok: !error, output: `${stdout}${stderr}`.trim() || (error?.message ?? '') }),
      )
    })
    if (!result.ok) return { ok: false, output: result.output }
    const trees = parseDependencyTrees(await readFile(out, 'utf8'))
    return { ok: true, trees: trees.map((module) => ({ module })) }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
