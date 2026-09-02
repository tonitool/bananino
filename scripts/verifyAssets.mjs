/*
 * Guards against electron-builder silently dropping build assets: it excludes some
 * extensions by default (*.obj among them), which shipped an app with no radio prop
 * while the dev build looked perfect. Every file we build must reach the archive.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const BUILD_DIR = 'build'
const ASAR = 'release/mac-arm64/Bananino.app/Contents/Resources/app.asar'

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const IGNORED = /\.map$/

const expected = walk(BUILD_DIR)
  .filter((path) => !IGNORED.test(path))
  .map((path) => `/${BUILD_DIR}/${relative(BUILD_DIR, path)}`)

const packaged = new Set(
  execFileSync('npx', ['asar', 'list', ASAR], { encoding: 'utf8' }).split('\n'),
)

const missing = expected.filter((path) => !packaged.has(path))

if (missing.length > 0) {
  console.error(`verify:assets: ${missing.length} build asset(s) missing from app.asar:`)
  for (const path of missing) console.error(`  ${path}`)
  console.error('\nAdd an explicit pattern for them to build.files in package.json.')
  process.exit(1)
}

/*
 * The native helpers ship as extra resources, outside the archive, because macOS cannot
 * exec a file inside an asar. They are checked here too: without them the meeting
 * feature fails only at the moment a user presses Record.
 */
const HELPERS = ['bananino-audio-tap', 'whisper-cli']
const helperDir = 'release/mac-arm64/Bananino.app/Contents/Resources/bin'
const missingHelpers = HELPERS.filter((name) => {
  try {
    statSync(join(helperDir, name))
    return false
  } catch {
    return true
  }
})

if (missingHelpers.length > 0) {
  console.error(`verify:assets: native helper(s) missing from the app bundle: ${missingHelpers.join(', ')}`)
  console.error('Check build.extraResources in package.json, and run npm run build:native.')
  process.exit(1)
}

console.log(
  `verify:assets: all ${expected.length} build assets in app.asar, ` +
    `${HELPERS.length} native helpers in Resources/bin`,
)
