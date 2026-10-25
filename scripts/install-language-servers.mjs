// Downloads the Java and Kotlin language servers AnyCode runs, and the debug adapters, into
// ~/Library/Application Support/AnyCode/language-servers/<server>/<version>/, verifying checksums.
// TypeScript needs no download (typescript-go ships as an npm dependency).
//
// usage: node scripts/install-language-servers.mjs [jdtls] [kotlin] [java-debug] [js-debug]
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  // Microsoft java-debug, EPL-1.0: a jdtls plugin bundle that serves the Debug Adapter Protocol.
  'java-debug': {
    version: '0.53.1',
    url: 'https://repo1.maven.org/maven2/com/microsoft/java/com.microsoft.java.debug.plugin/0.53.1/com.microsoft.java.debug.plugin-0.53.1.jar',
    // Maven Central publishes SHA-1 checksums.
    checksumUrl: 'https://repo1.maven.org/maven2/com/microsoft/java/com.microsoft.java.debug.plugin/0.53.1/com.microsoft.java.debug.plugin-0.53.1.jar.sha1',
    algorithm: 'sha1',
    unpack: (archive, dir) => copyFile(archive, join(dir, 'com.microsoft.java.debug.plugin-0.53.1.jar')),
  },
  // Microsoft vscode-js-debug (standalone DAP server), MIT. The release has no checksum file; this
  // is the SHA-256 of the archive when it was pinned.
  'js-debug': {
    version: '1.140.0',
    url: 'https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.0/js-debug-dap-v1.140.0.tar.gz',
    checksum: '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968',
    unpack: (archive, dir) => execFileSync('tar', ['-xzf', archive, '-C', dir]),
  },
}

async function download(url, target) {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${response.status} ${url}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
}

async function digest(path, algorithm) {
  return createHash(algorithm).update(await readFile(path)).digest('hex')
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
  const algorithm = server.algorithm ?? 'sha256'
  const expected = server.checksum ?? (await (await fetch(server.checksumUrl)).text()).trim().split(/\s+/)[0]?.toLowerCase()
  const actual = await digest(archive, algorithm)
  if (!expected || expected !== actual) throw new Error(`${name}: ${algorithm} mismatch (expected ${expected}, got ${actual})`)
  await server.unpack(archive, staging)
  await rm(archive)
  await writeFile(join(staging, '.installed'), JSON.stringify({ version: server.version, url: server.url, [algorithm]: actual }, null, 2))
  await rm(dir, { recursive: true, force: true })
  await rename(staging, dir)
  console.log(`${name} ${server.version} installed in ${dir}`)
}

const requested = process.argv.slice(2)
for (const name of requested.length ? requested : Object.keys(SERVERS)) await install(name)
