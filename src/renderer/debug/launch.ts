// Starting debug sessions (Debug ⌃D, DebugClass ⌃⇧D, "Debug" in menus and CodeLenses).
// - JVM configurations (Spring Boot, JUnit) run through the build like Run does, with a JDWP agent
//   that waits for a debugger; java-debug, a jdtls plugin, attaches to it.
// - npm scripts and Node files run under js-debug, which asks AnyCode to start the process in a
//   terminal (runInTerminal) and opens a child session per Node process (startDebugging).
import { basename, dirname } from '@shared/paths'
import { debugKind, type RunConfigurationSpec } from '@shared/runConfigurations'
import { languageServerRouter } from '../lsp/client'
import { notify } from '../state/notifications'
import { showToolWindow, workbench } from '../state/workbench'
import { debugGroupFor } from '../terminal/ptySessions'
import { addSession } from './debugState'
import { DapClient } from './dap'
import { DebugSession } from './session'

const INSTALL_HINT = 'Install it with: node scripts/install-language-servers.mjs'
/** How long a build may take before the JVM listens for the debugger. */
const JVM_START_TIMEOUT_MS = 10 * 60_000
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const canDebug = (spec: RunConfigurationSpec | undefined): boolean => spec !== undefined && debugKind(spec) !== null

/** Debugs a run configuration; the result says whether a session started. */
export async function debugConfiguration(spec: RunConfigurationSpec): Promise<void> {
  const kind = debugKind(spec)
  const root = workbench.get().project?.root
  if (!kind || !root) {
    notify('warning', `Cannot debug ${spec.name}`, 'Debugging works for Spring Boot, JUnit and npm configurations.')
    return
  }
  if (kind === 'java') await debugJvm(spec, root)
  else await debugNode(root, spec.name, { configuration: spec })
}

/** Debugs a Node script (a .js/.ts file or scratch file) under js-debug. */
export async function debugScript(path: string): Promise<void> {
  const root = workbench.get().project?.root
  if (root) await debugNode(root, basename(path), { program: path })
}

/** The console terminal of a session: the debugged process runs there, as in IntelliJ's Console tab. */
async function startConsole(session: DebugSession, title: string, start: { cwd: string; script?: string; command?: string[]; env?: Record<string, string> }): Promise<string> {
  const group = debugGroupFor(session.root)
  const id = await group.create({ title, ...start })
  session.consoleId ??= id
  // The build goes on after the debugged JVM exits (Surefire prints the results); only Stop ends it.
  group.onExit(id, () => {
    // The program ended on its own (or failed to build): the session is over.
    if (session.consoleId === id) session.terminate()
  })
  return id
}

/**
 * The port of a JVM waiting for the debugger: from its "Listening for transport" line (Spring Boot,
 * Gradle), or once the expected port listens (Surefire swallows the forked JVM's output).
 */
function waitForJvm(session: DebugSession, consoleId: string, port: number): Promise<number> {
  const group = debugGroupFor(session.root)
  return new Promise((resolve, reject) => {
    let output = ''
    let finished = false
    const offOutput = group.onOutput(consoleId, (data) => {
      output = (output + data.replace(ANSI, '')).slice(-4000)
      const match = /Listening for transport dt_socket at address: ?(\d+)/.exec(output)
      if (match) done(null, Number(match[1]))
    })
    const offExit = group.onExit(consoleId, (code) => done(new Error(`The process exited with code ${code} before the JVM started`)))
    void window.anycode.invoke('debug:waitForListener', port, JVM_START_TIMEOUT_MS).then((listening) =>
      done(listening ? null : new Error('The JVM did not start listening for the debugger in time'), port),
    )
    function done(error: Error | null, found?: number): void {
      if (finished) return
      finished = true
      offOutput()
      offExit()
      if (error) reject(error)
      else resolve(found!)
    }
  })
}

async function debugJvm(spec: RunConfigurationSpec, root: string): Promise<void> {
  const adapters = await window.anycode.invoke('debug:adapters')
  if (!adapters.java) {
    notify('error', 'java-debug is not installed', `${INSTALL_HINT} java-debug`)
    return
  }
  const session = new DebugSession(spec.name, 'java', root, () => void debugJvm(spec, root))
  addSession(session)
  showToolWindow('Debug', false)
  session.setMessage('Starting the Java language server…')

  // java-debug runs inside jdtls; asking early lets it import the project while the build runs.
  const adapterPort = (async () => {
    const router = await languageServerRouter('java', root)
    if (!router) throw new Error(`The Java language server is not available. ${INSTALL_HINT} jdtls`)
    try {
      return await router.request<number>('workspace/executeCommand', { command: 'vscode.java.startDebugSession', arguments: [] })
    } catch (error) {
      throw new Error(`jdtls did not start java-debug (${errorText(error)}). Restart AnyCode after installing it.`, { cause: error })
    }
  })()
  adapterPort.catch(() => undefined)

  try {
    const port = await window.anycode.invoke('debug:freePort')
    const command = await window.anycode.invoke('run:command', root, spec, { port })
    const consoleId = await startConsole(session, spec.name, { cwd: command.cwd, script: command.script, env: command.env })
    session.setMessage('Building and starting the JVM…')
    const jvmPort = await waitForJvm(session, consoleId, command.debugPort ?? port)
    session.setMessage('Attaching the debugger…')
    const client = await DapClient.connect(await adapterPort)
    session.addClient(client, true)
    client.on('initialized', () => void session.configure(client))
    await session.initialize(client, 'java')
    await client.request('attach', { type: 'java', request: 'attach', name: spec.name, hostName: '127.0.0.1', port: jvmPort, timeout: 30_000 })
  } catch (error) {
    if (session.active) {
      session.fail(errorText(error))
      notify('error', `Cannot debug ${spec.name}`, errorText(error))
    }
  }
}

type NodeTarget = { configuration: RunConfigurationSpec } | { program: string }

interface RunInTerminalArguments {
  title?: string
  cwd: string
  args: string[]
  env?: Record<string, string | null>
  argsCanBeInterpretedByShell?: boolean
}

interface StartDebuggingArguments {
  request: 'launch' | 'attach'
  configuration: Record<string, unknown>
}

async function debugNode(root: string, name: string, target: NodeTarget): Promise<void> {
  const adapters = await window.anycode.invoke('debug:adapters')
  if (!adapters.node) {
    notify('error', 'js-debug is not installed', `${INSTALL_HINT} js-debug`)
    return
  }
  const session = new DebugSession(name, 'node', root, () => void debugNode(root, name, target))
  addSession(session)
  showToolWindow('Debug', false)
  session.setMessage('Starting js-debug…')

  try {
    const port = await window.anycode.invoke('debug:startNodeAdapter')
    let launch: Record<string, unknown>
    if ('configuration' in target) {
      // The configuration's script (npm run …) under a shell: js-debug follows every Node process it starts.
      const command = await window.anycode.invoke('run:command', root, target.configuration)
      launch = { cwd: command.cwd, runtimeExecutable: '/bin/sh', runtimeArgs: ['-c', command.script], env: command.env }
    } else {
      launch = { cwd: dirname(target.program), program: target.program }
    }

    const connect = async (main: boolean, request: 'launch' | 'attach', configuration: Record<string, unknown>): Promise<void> => {
      const client = await DapClient.connect(port)
      session.addClient(client, main)
      client.handle('runInTerminal', async (args) => {
        const { title, cwd, args: argv, env, argsCanBeInterpretedByShell } = args as RunInTerminalArguments
        const definedEnv = Object.fromEntries(Object.entries(env ?? {}).filter((entry): entry is [string, string] => entry[1] !== null))
        const start = argsCanBeInterpretedByShell ? { script: argv.join(' ') } : { command: argv }
        await startConsole(session, title ?? name, { cwd, env: definedEnv, ...start })
        return {}
      })
      client.handle('startDebugging', (args) => {
        const child = args as StartDebuggingArguments
        void connect(false, child.request, child.configuration).catch((error: unknown) => notify('error', name, errorText(error)))
        return {}
      })
      client.on('initialized', () => void session.configure(client))
      await session.initialize(client, 'pwa-node', { supportsRunInTerminalRequest: true, supportsStartDebuggingRequest: true })
      await client.request(request, configuration)
    }

    await connect(true, 'launch', {
      type: 'pwa-node',
      request: 'launch',
      name,
      console: 'integratedTerminal',
      skipFiles: ['<node_internals>/**'],
      ...launch,
    })
  } catch (error) {
    if (session.active) {
      session.fail(errorText(error))
      notify('error', `Cannot debug ${name}`, errorText(error))
    }
  }
}
