// Downloads the Java and Kotlin language servers AnyCode runs into
// ~/Library/Application Support/AnyCode/language-servers/<server>/<version>/, verifying SHA-256.
// TypeScript needs no download (typescript-go ships as an npm dependency).
//
// usage: node scripts/install-language-servers.mjs [jdtls] [kotlin]
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ROOT = join(homedir(), 'Library', 'Application Support', 'AnyCode', 'language-servers')
const arm = process.arch === 'arm64'

const SERVERS = {
  // Eclipse JDT Language Server, EPL-2.0
  jdtls: {
    version: '1.63.0',
    url: 'https://download.eclipse.org/jdtls/milestones/1.63.0/jdt-language-server-1.63.0-202610191322.tar.gz',
    checksumUrl: 'https://download.eclipse.org/jdtls/milestones/1.63.0/jdt-language-server-1.63.0-202610191322.tar.gz.sha256',
    unpack: (archive, dir) => execFileSync('tar', ['-xzf', archive, '-C', dir]),
  },
  // JetBrains Kotlin LSP (standalone), Apache-2.0
  kotlin: {
    version: '263.7084.0',
    url: `https://download.jetbrains.com/language-server/kotlin-server/263.7084.0/kotlin-server-263.7084.0${arm ? '-aarch64' : ''}.sit`,
    checksumUrl: `https://download.jetbrains.com/language-server/kotlin-server/263.7084.0/kotlin-server-263.7084.0${arm ? '-aarch64' : ''}.sit.sha256`,
    // .sit is a zip archive
    unpack: (archive, dir) => execFileSync('ditto', ['-x', '-k', archive, dir]),
  },
}

async function download(url, target) {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${response.status} ${url}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function install(name) {
  const server = SERVERS[name]
  if (!server) throw new Error(`Unknown server ${name}; expected one of ${Object.keys(SERVERS).join(', ')}`)
  const dir = join(ROOT, name, server.version)
  if (existsSync(join(dir, '.installed'))) {
    console.log(`${name} ${server.version} already installed in ${dir}`)
    return
  }
  const staging = `${dir}.partial`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  const archive = join(staging, 'archive')
  console.log(`downloading ${name} ${server.version}...`)
  await download(server.url, archive)
  const expected = (await (await fetch(server.checksumUrl)).text()).trim().split(/\s+/)[0]?.toLowerCase()
  const actual = await sha256(archive)
  if (!expected || expected !== actual) throw new Error(`${name}: SHA-256 mismatch (expected ${expected}, got ${actual})`)
  server.unpack(archive, staging)
  await rm(archive)
  await writeFile(join(staging, '.installed'), JSON.stringify({ version: server.version, url: server.url, sha256: actual }, null, 2))
  await rm(dir, { recursive: true, force: true })
  await rename(staging, dir)
  console.log(`${name} ${server.version} installed in ${dir}`)
}

const requested = process.argv.slice(2)
for (const name of requested.length ? requested : Object.keys(SERVERS)) await install(name)
