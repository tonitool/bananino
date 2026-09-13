import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const SCRIPT_TIMEOUT_MS = 5000

/** macOS's error when Automation permission has not been granted for an app. */
export const NOT_AUTHORISED = /-1743|Not authorized/i

/**
 * Runs an AppleScript, one `-e` per line.
 *
 * Keeping the script off the filesystem is the point: nothing to write, nothing to clean
 * up, and nothing another process can edit between writing it and running it. The cost is
 * that a line is the unit — `¬` continuations cannot span two `-e` arguments — which is
 * why every script builder in here writes one statement per line.
 */
export const osascript = async (script, { timeout = SCRIPT_TIMEOUT_MS } = {}) => {
  const args = script
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => ['-e', line])

  const { stdout } = await run('osascript', args, { timeout })
  return stdout
}
