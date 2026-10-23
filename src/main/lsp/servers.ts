// How each language server is launched. Pure Node (no Electron), so resolution can be tested.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, type Dirent } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { LanguageServerId } from '@shared/languageServers'

export interface ServerCommand {
  file: string
  args: string[]
  env?: Record<string, string>
}

export interface ServerContext {
  root: string
  /** <appData>/AnyCode: language-servers/ holds downloads, jdtls-workspaces/ jdtls data. */
  appDir: string
  env: NodeJS.ProcessEnv
}

const require = createRequire(__filename)

/** Native typescript-go binary from the platform package that `typescript-native` (TS 7) installs. */
export function typescriptGoBinary(): string {
  const manifest = require.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`)
  return join(dirname(manifest), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc')
}

/** Compares dotted numeric versions ("1.63.0" < "1.100.0"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Newest fully installed version directory of a server under <appDir>/language-servers/<name>. */
export function installedServer(appDir: string, name: string): string | null {
  const base = join(appDir, 'language-servers', name)
  if (!existsSync(base)) return null
  const versions = readdirSync(base)
    .filter((v) => /^\d+(\.\d+)*$/.test(v) && existsSync(join(base, v, '.installed')))
    .sort(compareVersions)
  const latest = versions.at(-1)
  return latest ? join(base, latest) : null
}

/** A Java 21+ runtime: JAVA_HOME when set, else macOS java_home, else `java` on PATH. */
export function javaExecutable(env: NodeJS.ProcessEnv): string {
  if (env.JAVA_HOME && existsSync(join(env.JAVA_HOME, 'bin', 'java'))) return join(env.JAVA_HOME, 'bin', 'java')
  if (process.platform === 'darwin') {
    try {
      const home = execFileSync('/usr/libexec/java_home', ['-v', '21+'], { encoding: 'utf8' }).trim()
      if (home) return join(home, 'bin', 'java')
    } catch {
      // no registered JDK 21+; fall back to PATH
    }
  }
  return 'java'
}

function missing(name: string): Error {
  return new Error(`${name} is not installed. Run: node scripts/install-language-servers.mjs`)
}

function jdtls(context: ServerContext): ServerCommand {
  const home = context.env.ANYCODE_JDTLS_HOME ?? installedServer(context.appDir, 'jdtls')
  if (!home) throw missing('jdtls')
  const launcher = readdirSync(join(home, 'plugins')).find((f) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f))
  if (!launcher) throw new Error(`No equinox launcher in ${home}/plugins`)
  const config = process.platform === 'darwin' ? 'config_mac' : process.platform === 'win32' ? 'config_win' : 'config_linux'
  // One workspace (index) directory per project, like jdtls' own launcher.
  const data = join(context.appDir, 'jdtls-workspaces', createHash('sha1').update(context.root).digest('hex'))
  return {
    file: javaExecutable(context.env),
    args: [
      '-Djdk.xml.maxGeneralEntitySizeLimit=0',
      '-Djdk.xml.totalEntitySizeLimit=0',
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dosgi.checkConfiguration=true',
      `-Dosgi.sharedConfiguration.area=${join(home, config)}`,
      '-Dosgi.sharedConfiguration.area.readOnly=true',
      '-Dosgi.configuration.cascaded=true',
      '-Xms256m',
      '-Xmx2G',
      '--add-modules=ALL-SYSTEM',
      '--add-opens',
      'java.base/java.util=ALL-UNNAMED',
      '--add-opens',
      'java.base/java.lang=ALL-UNNAMED',
      '-jar',
      join(home, 'plugins', launcher),
      '-data',
      data,
    ],
  }
}

function kotlin(context: ServerContext): ServerCommand {
  const home = context.env.ANYCODE_KOTLIN_LSP_HOME ?? installedServer(context.appDir, 'kotlin')
  if (!home) throw missing('kotlin-lsp')
  const launcher = findKotlinLauncher(home)
  if (!launcher) throw new Error(`No kotlin-lsp launcher in ${home}`)
  return {
    file: launcher,
    args: [
      '--stdio',
      // Indexes persist per project instead of a fresh temp directory on every start.
      `--system-path=${join(context.appDir, 'kotlin-system', createHash('sha1').update(context.root).digest('hex'))}`,
      // No usage statistics are sent on the user's behalf.
      '--data-sharing=none',
    ],
  }
}

/**
 * The standalone archive's launcher: bin/intellij-server (kotlin-lsp.sh is a deprecated wrapper
 * around it), somewhere below the install directory.
 */
export function findKotlinLauncher(home: string): string | null {
  const queue = [home]
  for (let depth = 0; queue.length > 0 && depth < 4; depth++) {
    let deprecated: string | null = null
    for (const dir of queue.splice(0)) {
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      if (existsSync(join(dir, 'bin', 'intellij-server'))) return join(dir, 'bin', 'intellij-server')
      if (entries.some((e) => e.name === 'kotlin-lsp.sh')) deprecated ??= join(dir, 'kotlin-lsp.sh')
      queue.push(...entries.filter((e) => e.isDirectory() && e.name !== 'bin').map((e) => join(dir, e.name)))
    }
    if (deprecated) return deprecated
  }
  return null
}

export function serverCommand(server: LanguageServerId, context: ServerContext): ServerCommand {
  switch (server) {
    case 'typescript':
      return { file: typescriptGoBinary(), args: ['--lsp', '--stdio'] }
    case 'java':
      return jdtls(context)
    case 'kotlin':
      return kotlin(context)
  }
}
