// Bundles scripts/bridge-probe.ts with rolldown (resolving the @shared alias) and runs it.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'out'), { recursive: true })
await build({
  input: join(root, 'scripts/bridge-probe.ts'),
  platform: 'node',
  resolve: { alias: { '@shared': resolve(root, 'src/shared') } },
  external: ['@lydell/node-pty', 'ws'],
  output: { file: join(root, 'out/bridge-probe.mjs'), format: 'esm' },
  logLevel: 'warn',
})
execFileSync(process.execPath, [join(root, 'out/bridge-probe.mjs'), ...process.argv.slice(2)], { stdio: 'inherit', cwd: root })
