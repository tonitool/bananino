/** Practical ceiling for a prefilled URL before browsers and servers start truncating. */
const MAX_URL_LENGTH = 6000

/**
 * Where a note can be sent for a second opinion.
 *
 * ChatGPT and Claude accept a prefilled prompt in the URL. Gemini has no documented way to
 * do that, so the note goes to the clipboard and the app says so rather than opening an
 * empty chat and hoping.
 */
export const AI_TARGETS = Object.freeze({
  chatgpt: { label: 'ChatGPT', base: 'https://chatgpt.com/', param: 'q' },
  claude: { label: 'Claude', base: 'https://claude.ai/new', param: 'q' },
  gemini: { label: 'Gemini', base: 'https://gemini.google.com/app', param: null },
})

export const isAiTarget = (name) => Object.hasOwn(AI_TARGETS, name)

/**
 * Returns the URL to open, and whether the text must go via the clipboard instead of the
 * URL — either because the target cannot prefill, or because the note is too long to
 * survive one.
 */
export const buildHandoff = (name, text) => {
  const target = AI_TARGETS[isAiTarget(name) ? name : 'chatgpt']
  const body = String(text ?? '').trim()

  if (!target.param || !body) {
    return { url: target.base, needsClipboard: Boolean(body), label: target.label }
  }

  const url = `${target.base}?${target.param}=${encodeURIComponent(body)}`
  if (url.length > MAX_URL_LENGTH) {
    return { url: target.base, needsClipboard: true, label: target.label }
  }
  return { url, needsClipboard: false, label: target.label }
}
