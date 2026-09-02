import { context, build } from 'esbuild'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'build')
const WATCH = process.argv.includes('--watch')

const STATIC_FILES = [
  [join(ROOT, 'src', 'renderer', 'index.html'), join(OUT_DIR, 'index.html')],
  [join(ROOT, 'assets', 'character.glb'), join(OUT_DIR, 'character.glb')],
  /*
   * Copied out as .mesh, not .obj: electron-builder excludes *.obj by default (it is a
   * C object-file extension), which silently shipped an app with no radio prop while the
   * dev build looked perfect. OBJLoader parses text and ignores the extension.
   */
  [join(ROOT, 'assets', 'musical-note.obj'), join(OUT_DIR, 'musical-note.mesh')],
  [join(ROOT, 'assets', 'radio.obj'), join(OUT_DIR, 'radio.mesh')],
  /*
   * Copied rather than bundled: AudioWorklet.addModule fetches this by URL and it runs
   * on the audio thread, in its own scope.
   */
  [join(ROOT, 'src', 'renderer', 'audio', 'pcmWorklet.js'), join(OUT_DIR, 'pcmWorklet.js')],
  ...['color', 'roughness', 'metalness'].map((map) => [
    join(ROOT, 'assets', 'radio', `${map}.png`),
    join(OUT_DIR, 'radio', `${map}.png`),
  ]),
]

/** The model is ~28 MB; re-copying it on every rebuild is pure waste. */
const copyIfStale = (from, to) => {
  try {
    if (statSync(to).mtimeMs >= statSync(from).mtimeMs) return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  copyFileSync(from, to)
}

const options = {
  entryPoints: {
    renderer: join(ROOT, 'src', 'renderer', 'main.js'),
  },
  outdir: OUT_DIR,
  bundle: true,
  format: 'esm',
  target: 'chrome130',
  sourcemap: true,
  logLevel: 'info',
  loader: { '.glb': 'file' },
}

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(join(OUT_DIR, 'radio'), { recursive: true })
for (const [from, to] of STATIC_FILES) copyIfStale(from, to)

if (WATCH) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('Watching src/renderer for changes…')
} else {
  await build(options)
}
