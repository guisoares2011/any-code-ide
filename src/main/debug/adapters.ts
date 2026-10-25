// Where the debug adapters are installed (scripts/install-language-servers.mjs java-debug js-debug).
// Pure Node, so resolution can be tested.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { installedServer } from '../lsp/servers'

/** java-debug's jdtls plugin jar, loaded through jdtls' `bundles` initialization option. */
export function javaDebugBundle(appDir: string, env: NodeJS.ProcessEnv): string | null {
  if (env.ANYCODE_JAVA_DEBUG_JAR) return existsSync(env.ANYCODE_JAVA_DEBUG_JAR) ? env.ANYCODE_JAVA_DEBUG_JAR : null
  const home = installedServer(appDir, 'java-debug')
  const jar = home && readdirSync(home).find((f) => /^com\.microsoft\.java\.debug\.plugin-.*\.jar$/.test(f))
  return home && jar ? join(home, jar) : null
}

/** js-debug's standalone DAP server script (`dapDebugServer.js [port] [host]`). */
export function jsDebugServer(appDir: string, env: NodeJS.ProcessEnv): string | null {
  const home = env.ANYCODE_JS_DEBUG_HOME ?? installedServer(appDir, 'js-debug')
  if (!home) return null
  for (const candidate of [join(home, 'js-debug', 'src', 'dapDebugServer.js'), join(home, 'src', 'dapDebugServer.js')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Adds java-debug to jdtls' `initialize`, like vscode-java does for its extensions: jdtls then
 * answers `vscode.java.startDebugSession` with the port of a DAP server.
 */
export function withJavaDebugBundle(message: unknown, bundle: string | null): unknown {
  const m = message as { method?: string; params?: { initializationOptions?: Record<string, unknown> } }
  if (!bundle || m.method !== 'initialize' || !m.params) return message
  const options = m.params.initializationOptions ?? {}
  const bundles = Array.isArray(options.bundles) ? (options.bundles as string[]) : []
  return { ...m, params: { ...m.params, initializationOptions: { ...options, bundles: [...bundles, bundle] } } }
}
