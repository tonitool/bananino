import { context, build } from 'esbuild'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { characterIds } from '../src/renderer/scene/characters.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'build')
const WATCH = process.argv.includes('--watch')

/** Whatever collaboration art is present, so a new brand needs no build edit. */
const shirtArtwork = () => {
  try {
    return readdirSync(join(ROOT, 'assets', 'shirt')).filter((file) => file.endsWith('.png'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return []
  }
}

const STATIC_FILES = [
  [join(ROOT, 'src', 'renderer', 'index.html'), join(OUT_DIR, 'index.html')],
  /* One optimised model per character, loaded by id at runtime — see characters.js. */
  ...characterIds().map((id) => [
    join(ROOT, 'assets', 'characters', `${id}.glb`),
    join(OUT_DIR, 'characters', `${id}.glb`),
  ]),
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
  /*
   * The polo, baked open and given usable UVs by scripts/bake-garment.mjs. Committed
   * rather than generated, unlike the characters: the bake leaves it under 100KB.
   */
  [join(ROOT, 'assets', 'costumes', 'polo.glb'), join(OUT_DIR, 'costumes', 'polo.glb')],
  /*
   * Collaboration artwork, copied by whatever is in the folder rather than by name: a new
   * brand should be a file and a registry entry, not an edit to the build.
   */
  ...shirtArtwork().map((file) => [
    join(ROOT, 'assets', 'shirt', file),
    join(OUT_DIR, 'shirt', file),
  ]),
]

/** The models are megabytes each; re-copying them on every rebuild is pure waste. */
const copyIfStale = (from, to) => {
  try {
    if (statSync(to).mtimeMs >= statSync(from).mtimeMs) return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    copyFileSync(from, to)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    // The optimised models are generated, not committed, so this is the first thing a
    // fresh clone hits — and "ENOENT" alone does not say what to run.
    throw new Error(`${from} is missing. Run \`npm run optimise-model\` to generate it.`)
  }
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
mkdirSync(join(OUT_DIR, 'characters'), { recursive: true })
mkdirSync(join(OUT_DIR, 'costumes'), { recursive: true })
mkdirSync(join(OUT_DIR, 'shirt'), { recursive: true })
for (const [from, to] of STATIC_FILES) copyIfStale(from, to)

if (WATCH) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('Watching src/renderer for changes…')
} else {
  await build(options)
}
