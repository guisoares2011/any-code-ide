// Renders build/icon.svg to build/icon.icns with Electron, offscreen (no window, no Dock icon),
// then iconutil. Run after changing the SVG: npx electron scripts/make-icon.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const svg = readFileSync(join(build, 'icon.svg'), 'utf8')

app.dock?.hide()
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const png = (await window.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })).toPNG()
  writeFileSync(join(build, 'icon.png'), png)

  const iconset = join(build, 'icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`
      execFileSync('sips', ['-z', String(pixels), String(pixels), join(build, 'icon.png'), '--out', join(iconset, name)], { stdio: 'ignore' })
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(build, 'icon.icns')])
  rmSync(iconset, { recursive: true, force: true })
  console.log('build/icon.icns written')
  app.quit()
})
