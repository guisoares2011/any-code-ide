// New UI (expui) icons shipped in resources/intellij-community. Names are paths below an icon root
// without extension, e.g. "toolwindows/project@20x20" or "general/chevronDown". The dark variant
// ("_dark") is preferred, falling back to the light file when there is none.

const platformIcons = import.meta.glob('@intellij/platform/icons/src/expui/**/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const terminalIcons = import.meta.glob('@intellij/plugins/terminal/resources/icons/expui/**/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const byName = new Map<string, string>()
for (const [path, url] of Object.entries({ ...platformIcons, ...terminalIcons })) {
  const name = path.replace(/^.*\/expui\//, '').replace(/\.svg$/, '')
  byName.set(name, url)
}

export function iconUrl(name: string): string | undefined {
  return byName.get(`${name}_dark`) ?? byName.get(name)
}

/** File-type icon for a file name, from the platform fileTypes set. */
export function fileIconName(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower === '.gitignore' || lower === '.npmignore') return 'fileTypes/gitignore'
  if (lower === '.editorconfig') return 'fileTypes/editorConfig'
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
      return 'fileTypes/javaScript'
    case 'json':
    case 'jsonc':
      return 'fileTypes/json'
    case 'java':
      return 'fileTypes/java'
    case 'class':
      return 'fileTypes/javaClass'
    case 'html':
    case 'htm':
      return 'fileTypes/html'
    case 'css':
    case 'scss':
    case 'less':
      return 'fileTypes/css'
    case 'xml':
    case 'svg':
      return 'fileTypes/xml'
    case 'yml':
    case 'yaml':
      return 'fileTypes/yaml'
    case 'properties':
    case 'toml':
    case 'ini':
      return 'fileTypes/properties'
    case 'sh':
    case 'zsh':
    case 'bash':
      return 'fileTypes/shell'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'ico':
    case 'icns':
      return 'fileTypes/image'
    case 'zip':
    case 'jar':
    case 'tar':
    case 'gz':
      return 'fileTypes/archive'
    case 'csv':
      return 'fileTypes/csv'
    case 'map':
      return 'fileTypes/sourceMap'
    case 'md':
    case 'txt':
    case 'log':
      return 'fileTypes/text'
    default:
      return 'fileTypes/unknown'
  }
}
