/**
 * "Can it actually reach these?" — asked of the tools directly, with no model involved.
 *
 * This exists because of a week of reports that could not be acted on. A small local model
 * relaying a tool result will happily produce "I cannot run the file search right now, and
 * it didn't find any matches" — two different answers in one sentence, neither of them
 * necessarily from the tool. From outside there was no way to tell a broken search from a
 * model narrating one, so every fix was a guess.
 *
 * So: press a button, and each tool runs for real. Whatever comes back came back from the
 * tool. If the check finds your file and the chat says it cannot, the chat is the problem
 * and no amount of work on the search will help.
 *
 * Every probe is a read, bounded, and phrased so the answer is useful on its own — a count
 * and an example beat "ok", which only means the code did not throw.
 */

/** One probe's result, in the shape the pane renders. */
const ok = (label, detail) => ({ label, state: 'ok', detail })
const warn = (label, detail) => ({ label, state: 'warn', detail })
const failed = (label, detail) => ({ label, state: 'failed', detail })

export const runToolCheck = async ({
  searchFiles,
  searchMessages,
  music,
  isAccessibilityTrusted,
  home,
}) => {
  const checks = []

  /*
   * Downloads, listed. Chosen over a search because it separates the two things that
   * look alike from outside: a folder macOS is withholding comes back as a refusal, and
   * an empty answer is genuinely an empty answer.
   */
  try {
    const outcome = await searchFiles({ folder: 'Downloads', limit: 5 })
    if (outcome.failed) checks.push(failed('Files · Downloads', outcome.failed))
    else if (outcome.files.length === 0) {
      checks.push(
        warn(
          'Files · Downloads',
          'Readable, but empty — which is also what a folder macOS is withholding looks like.',
        ),
      )
    } else {
      const newest = outcome.files[0].path.split('/').pop()
      checks.push(ok('Files · Downloads', `${outcome.files.length} found, newest “${newest}”`))
    }
  } catch (error) {
    checks.push(failed('Files · Downloads', error.message))
  }

  /* Spotlight itself, over the home folder: the index, rather than one folder's permission. */
  try {
    const outcome = await searchFiles({ query: 'png', folder: home, limit: 3 })
    if (outcome.failed) checks.push(failed('Files · Spotlight', outcome.failed))
    else {
      checks.push(
        outcome.files.length > 0
          ? ok('Files · Spotlight', `${outcome.files.length} matches for “png”`)
          : warn('Files · Spotlight', 'No match for “png” anywhere in your home folder — Spotlight may not be indexing it.'),
      )
    }
  } catch (error) {
    checks.push(failed('Files · Spotlight', error.message))
  }

  try {
    const outcome = await searchMessages('the', 3)
    if (outcome.blocked) checks.push(warn('Messages', outcome.hint))
    else if (outcome.failed) checks.push(failed('Messages', outcome.failed))
    else checks.push(ok('Messages', `readable — ${outcome.lines.length} recent matches for “the”`))
  } catch (error) {
    checks.push(failed('Messages', error.message))
  }

  try {
    const track = await music.current()
    checks.push(
      track
        ? ok('Music', `${track.title} — ${track.artist} (${track.playerLabel})`)
        : warn('Music', 'Nothing playing, or neither player is open.'),
    )
  } catch (error) {
    checks.push(failed('Music', error.message))
  }

  checks.push(
    isAccessibilityTrusted()
      ? ok('Rewrite (⌃⌥R)', 'Accessibility granted — it can read your selection.')
      : warn(
          'Rewrite (⌃⌥R)',
          'Accessibility not granted: System Settings → Privacy & Security → Accessibility → Bananino.',
        ),
  )

  return checks
}
