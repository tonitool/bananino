import { randomUUID } from 'node:crypto'

/**
 * Taking the text you have selected in another app, and putting the new text back.
 *
 * There is no polite way to do this on macOS. An app cannot read another app's selection,
 * so the only route is the one a person would take: press ⌘C, look at the clipboard, and
 * later press ⌘V. That needs **Accessibility** permission, and it borrows the clipboard —
 * so the whole point of this module is to borrow it carefully.
 *
 * Three things it gets right that a naive version does not:
 *
 *   - **It knows when nothing was selected.** ⌘C with no selection leaves the clipboard
 *     untouched, so a naive read comes back with whatever you copied an hour ago and
 *     cheerfully rewrites that. A sentinel is written first: if it is still there
 *     afterwards, nothing was selected and the buddy says so.
 *   - **It puts your clipboard back.** What you had copied is yours; it is restored once
 *     the paste is done, and the clipboard watcher is paused throughout so none of this
 *     lands in your clips history.
 *   - **It pastes into the app you were actually in.** The popup takes focus the moment
 *     it opens, so the frontmost app is recorded *before* that and reactivated before the
 *     paste. Without it, ⌘V goes to whatever happens to be in front — possibly a different
 *     document, which is the one mistake this feature must never make.
 */

/** A bundle id is a name, not a script. Anything else is refused rather than run. */
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/

export const frontmostScript = () =>
  [
    'tell application "System Events"',
    'set frontApp to first application process whose frontmost is true',
    'return (bundle identifier of frontApp) & tab & (name of frontApp)',
    'end tell',
  ].join('\n')

export const keystrokeScript = (key) =>
  [
    'tell application "System Events"',
    `keystroke "${key}" using command down`,
    'end tell',
    'return "ok"',
  ].join('\n')

export const activateScript = (bundleId) =>
  [`tell application id "${bundleId}" to activate`, 'return "ok"'].join('\n')

export const parseFrontmost = (output) => {
  const [bundleId, name] = String(output ?? '').trim().split('\t')
  if (!bundleId || !BUNDLE_ID.test(bundleId)) return null
  return { bundleId, name: (name ?? bundleId).trim() }
}

/** macOS's refusals, which are two different permissions in two different panes. */
const NO_ACCESSIBILITY = /-1719|-25211|not allowed to send keystrokes|assistive access/i
const NO_AUTOMATION = /-1743|Not authorized/i

export const ACCESSIBILITY_HINT =
  'macOS has not allowed Bananino to press keys for you: System Settings → Privacy & ' +
  'Security → Accessibility → switch on Bananino, then try again.'

export const AUTOMATION_HINT =
  'macOS has not allowed Bananino to talk to other apps: System Settings → Privacy & ' +
  'Security → Automation → Bananino → System Events.'

export const explain = (error) => {
  const message = `${error?.stderr ?? ''}${error?.message ?? ''}`
  if (NO_ACCESSIBILITY.test(message)) return ACCESSIBILITY_HINT
  if (NO_AUTOMATION.test(message)) return AUTOMATION_HINT
  console.warn('[rewrite] the selection could not be reached:', message.trim())
  return 'The selection could not be read. Try clicking into the text again.'
}

/** How long to wait for a copy to land, and how often to look. */
const COPY_TIMEOUT_MS = 900
const COPY_POLL_MS = 60
/** An app needs a moment between being activated and being able to take a keystroke. */
const ACTIVATE_MS = 220

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const createSelection = ({ osascript, clipboard, pauseClips, sleep = wait }) => {
  /**
   * The app in front right now, asked before the popup exists to take its place.
   */
  const frontmost = async () => parseFrontmost(await osascript(frontmostScript()))

  const capture = async () => {
    const yours = await clipboard.readText()
    const sentinel = `bananino-${randomUUID()}`

    const resume = pauseClips()
    try {
      await clipboard.writeText(sentinel)
      await osascript(keystrokeScript('c'))

      /*
       * Polled rather than slept at: a big selection in a slow app can take half a second
       * to reach the clipboard, and a fixed wait is either a stutter or a wrong answer.
       */
      let copied = sentinel
      for (let waited = 0; waited < COPY_TIMEOUT_MS && copied === sentinel; waited += COPY_POLL_MS) {
        await sleep(COPY_POLL_MS)
        copied = await clipboard.readText()
      }

      if (copied === sentinel || !copied.trim()) {
        await clipboard.writeText(yours)
        return { empty: true, yours }
      }

      return { text: copied, yours }
    } catch (error) {
      await clipboard.writeText(yours).catch(() => {})
      return { failed: explain(error) }
    } finally {
      resume()
    }
  }

  /**
   * Put text where the selection was: back to the app, then ⌘V.
   *
   * The clipboard is only restored after the paste has had time to happen — putting it
   * back immediately is a race that pastes the wrong thing every few tries.
   */
  const replace = async ({ text, target, yours }) => {
    const resume = pauseClips()
    try {
      await clipboard.writeText(text)

      if (target?.bundleId && BUNDLE_ID.test(target.bundleId)) {
        await osascript(activateScript(target.bundleId))
        await sleep(ACTIVATE_MS)
      }

      await osascript(keystrokeScript('v'))
      await sleep(ACTIVATE_MS)

      if (typeof yours === 'string') await clipboard.writeText(yours)
      return { replaced: true }
    } catch (error) {
      return { failed: explain(error) }
    } finally {
      resume()
    }
  }

  /** Giving the clipboard back — on a cancel as much as after a paste. */
  const restore = async (text) => {
    if (typeof text !== 'string') return
    const resume = pauseClips()
    try {
      await clipboard.writeText(text)
    } catch (error) {
      console.warn('[rewrite] the clipboard could not be put back:', error.message)
    } finally {
      resume()
    }
  }

  return { frontmost, capture, replace, restore }
}
