import { execFile } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const run = promisify(execFile)

/**
 * Boots the app and fails unless it renders.
 *
 * Checking that a process is alive is not enough: an uncaught error in the main process
 * leaves Electron showing a dialog, so the process stays up while the app is entirely
 * broken. Requiring a rendered frame is the only check that actually means "it works".
 */
const target = process.argv[2] === 'packaged'
  ? 'release/mac-arm64/lualala.app/Contents/MacOS/lualala'
  : null

// A running copy holds the single-instance lock, so a second one quits silently and this
// would report a failure that is really just "the app is already open".
const running = await run('pgrep', ['-f', 'lualala.app/Contents/MacOS/lualala']).then(
  () => true,
  () => false,
)
if (running) {
  console.error('verify: another copy of lualala is running — quit it first (menu bar → Quit).')
  process.exit(1)
}

const snapshot = join(tmpdir(), `lualala-verify-${Date.now()}.png`)
rmSync(snapshot, { force: true })

const [command, args] = target
  ? [target, ['--dev', `--snapshot=${snapshot}:5000`]]
  : ['npx', ['electron', '.', '--dev', `--snapshot=${snapshot}:5000`]]

let output = ''
try {
  const result = await run(command, args, { timeout: 90_000, killSignal: 'SIGKILL' })
  output = `${result.stdout}${result.stderr}`
} catch (error) {
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`
}

const problems = output
  .split('\n')
  .filter((line) => /Error|error:|Cannot access|not provide an export|Unhandled/.test(line))

if (!existsSync(snapshot)) {
  console.error('verify: the app did not render.\n')
  console.error(output.trim().split('\n').slice(0, 20).join('\n'))
  process.exit(1)
}

rmSync(snapshot, { force: true })

if (problems.length > 0) {
  console.error('verify: it rendered, but reported errors:\n')
  console.error(problems.slice(0, 10).join('\n'))
  process.exit(1)
}

console.log(`verify: ${target ? 'packaged app' : 'source'} boots and renders cleanly`)
