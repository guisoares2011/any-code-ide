// Downloads the IntelliJ Platform data files AnyCode ships (keymaps, themes, action names, icons)
// from JetBrains/intellij-community (Apache-2.0) at a pinned tag into resources/intellij-community/,
// keeping the repository paths. Re-run after changing TAG or FILES; the manifest records hashes.
//
// usage: node scripts/fetch-intellij-community.mjs
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'idea/261.22158.277' // IntelliJ IDEA 2026.1, the build installed on the reference machine
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'intellij-community')

const PLATFORM_RESOURCES = 'platform/platform-resources/src'
const ICONS = 'platform/icons/src/expui'

const icon = (path) => [`${ICONS}/${path}.svg`, `${ICONS}/${path}_dark.svg`]
const toolWindowIcon = (name) => [
  `${ICONS}/toolwindows/${name}@20x20.svg`,
  `${ICONS}/toolwindows/${name}@20x20_dark.svg`,
]

const FILES = [
  'LICENSE.txt',
  'NOTICE.txt',
  // keymaps: macOS chain is "$default" -> "Mac OS X 10.5+"
  `${PLATFORM_RESOURCES}/keymaps/$default.xml`,
  `${PLATFORM_RESOURCES}/keymaps/Mac OS X 10.5+.xml`,
  // action names
  'platform/platform-resources-en/src/messages/ActionsBundle.properties',
  // terminal plugin: its actions declare their own keymap entries
  'plugins/terminal/resources/META-INF/plugin.xml',
  'plugins/terminal/resources/META-INF/terminal.xml',
  'plugins/terminal/frontend/resources/intellij.terminal.frontend.xml',
  'plugins/terminal/resources/messages/TerminalBundle.properties',
  // VCS actions declare their shortcuts here (CheckinProject ⌘K, Vcs.Push ⇧⌘K...)
  'platform/vcs-impl/resources/META-INF/VcsActions.xml',
  'platform/dvcs-impl/resources/intellij.platform.vcs.dvcs.impl.xml',
  'plugins/terminal/resources/icons/expui/toolwindow/terminal@20x20.svg',
  'plugins/terminal/resources/icons/expui/toolwindow/terminal@20x20_dark.svg',
  // Maven tool window (plugins/maven, Apache-2.0)
  ...['toolwindow/maven@20x20', 'build/mavenProject', 'build/mavenModule', 'build/mavenGoal', 'build/mavenPlugin', 'build/mavenProfiles', 'build/mavenLoadChanges'].flatMap(
    (name) => [`plugins/maven/src/main/resources/images/expui/${name}.svg`, `plugins/maven/src/main/resources/images/expui/${name}_dark.svg`],
  ),
  // theme chain: Islands Dark -> ExperimentalDark -> Darcula, plus editor color schemes
  `${PLATFORM_RESOURCES}/themes/islands/ManyIslandsDark.theme.json`,
  `${PLATFORM_RESOURCES}/themes/islands/IslandSchemeDark.xml`,
  `${PLATFORM_RESOURCES}/themes/expUI/expUI_dark.theme.json`,
  `${PLATFORM_RESOURCES}/themes/expUI/expUI_darkScheme.xml`,
  `${PLATFORM_RESOURCES}/themes/darcula.theme.json`,
  `${PLATFORM_RESOURCES}/DefaultColorSchemesManager.xml`, // bundled "Default" and "Darcula" editor schemes
  // tool window stripe icons (20x20 in the New UI stripes)
  ...['project', 'commit', 'structure', 'vcs', 'problems', 'notifications', 'run', 'services', 'find'].flatMap(
    toolWindowIcon,
  ),
  // general UI icons
  ...[
    'general/add',
    'general/chevronDown',
    'general/chevronRight',
    'general/chevronLeft',
    'general/close',
    'general/closeSmall',
    'general/closeSmallHovered',
    'general/collapseAll',
    'general/expandAll',
    'general/locate',
    'general/moreVertical',
    'general/moreHorizontal',
    'general/search',
    'general/settings',
    'general/refresh',
    'general/hide',
    'general/vcs', // the New UI branch icon (AllIcons.Vcs.Branch maps here)
    'general/greenCheckmark',
    'general/warningDialog',
    'general/errorDialog',
    'run/run',
    'run/stop',
    'run/rerun',
    'run/debug',
    'vcs/changes',
    'vcs/commit',
    'vcs/diff',
    'vcs/push',
    'vcs/update',
    'nodes/folder',
    'nodes/library',
    'general/edit',
    'general/editorOnly',
    'general/editorPreview',
    'general/previewOnly',
    'general/remove',
    'general/copy',
    'nodes/module',
    'nodes/ideaProject',
    'nodes/sourceRoot',
    'nodes/testRoot',
    'nodes/resourcesRoot',
    'nodes/excludeRoot',
    'nodes/class',
    'nodes/interface',
    'nodes/enum',
    'nodes/method',
    'nodes/function',
    'nodes/field',
    'nodes/variable',
    'fileTypes/text',
    'fileTypes/unknown',
    'fileTypes/javaScript',
    'fileTypes/json',
    'fileTypes/java',
    'fileTypes/javaClass',
    'fileTypes/html',
    'fileTypes/css',
    'fileTypes/xml',
    'fileTypes/yaml',
    'fileTypes/properties',
    'fileTypes/shell',
    'fileTypes/image',
    'fileTypes/archive',
    'fileTypes/gitignore',
    'fileTypes/config',
    'fileTypes/editorConfig',
    'fileTypes/csv',
    'fileTypes/sourceMap',
  ].flatMap(icon),
]

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/')

async function fetchFile(path) {
  const url = `https://raw.githubusercontent.com/JetBrains/intellij-community/${TAG}/${encodePath(path)}`
  const response = await fetch(url)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

const manifest = { source: 'https://github.com/JetBrains/intellij-community', tag: TAG, license: 'Apache-2.0', files: {} }
const missing = []
const queue = [...FILES]
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let path = queue.shift(); path; path = queue.shift()) {
      const data = await fetchFile(path)
      if (!data) {
        missing.push(path)
        continue
      }
      const target = join(ROOT, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data)
      manifest.files[path] = createHash('sha256').update(data).digest('hex')
    }
  }),
)
manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)))
manifest.missing = missing.sort()
await writeFile(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`fetched ${Object.keys(manifest.files).length} files from ${TAG}; missing: ${missing.length}`)
for (const path of missing) console.log(`  missing ${path}`)
