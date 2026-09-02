import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RESOURCES = join(ROOT, 'resources')
const ICONSET = join(RESOURCES, 'icon.iconset')
const MASTER = join(RESOURCES, 'icon.png')

/** Kept small enough to fit on any screen: macOS clamps windows to the visible area. */
const RENDER_SIZE = 512
const ICON_SIZE = 1024
const SETTLE_MS = 4500

/** The sizes `iconutil` expects inside an .iconset bundle. */
const VARIANTS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

app.whenReady().then(renderIcon).catch((error) => {
  console.error('[icon] failed:', error)
  app.exit(1)
})

async function renderIcon() {
const win = new BrowserWindow({
  width: RENDER_SIZE,
  height: RENDER_SIZE,
  show: false,
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  webPreferences: {
    preload: join(ROOT, 'src', 'preload', 'index.cjs'),
    contextIsolation: true,
    sandbox: false,
    offscreen: false,
  },
})

win.webContents.on('console-message', (event) => console.log('[renderer]', event.message))

console.log('loading page…')
await win.loadFile(join(ROOT, 'build', 'index.html'), { query: { zoom: '0.68' } })
// A never-shown window is never composited, so capturePage would wait forever.
win.showInactive()
console.log('page loaded, settling…')
await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

console.log('capturing…')
const image = toSquare(await win.webContents.capturePage())
console.log('captured', image.getSize())

mkdirSync(RESOURCES, { recursive: true })
rmSync(ICONSET, { recursive: true, force: true })
mkdirSync(ICONSET, { recursive: true })

writeFileSync(MASTER, image.resize({ width: ICON_SIZE, height: ICON_SIZE }).toPNG())
for (const [name, size] of VARIANTS) {
  writeFileSync(join(ICONSET, name), image.resize({ width: size, height: size }).toPNG())
}

execFileSync('iconutil', ['--convert', 'icns', ICONSET, '--output', join(RESOURCES, 'icon.icns')])
rmSync(ICONSET, { recursive: true, force: true })

console.log('Wrote resources/icon.icns and resources/icon.png')
app.exit(0)
}

/** Centre-crops a capture so a clamped window cannot produce a stretched icon. */
function toSquare(image) {
  const { width, height } = image.getSize()
  if (width === height) return image
  const side = Math.min(width, height)
  return image.crop({
    x: Math.round((width - side) / 2),
    y: Math.round((height - side) / 2),
    width: side,
    height: side,
  })
}
