import { pickFrom } from './phrases.js'

const VISIBLE_MS = 2200

/** A single reusable bubble: a new line replaces the old one instead of stacking. */
export const createSpeechBubble = (element) => {
  let hideTimer = null
  let lastLine = null

  const say = (lines, { duration = VISIBLE_MS, tone = 'happy' } = {}) => {
    const line = Array.isArray(lines) ? pickFrom(lines, lastLine) : lines
    if (!line) return

    lastLine = line
    element.textContent = line
    element.dataset.tone = tone
    element.classList.add('is-visible')

    clearTimeout(hideTimer)
    hideTimer = setTimeout(hide, duration)
  }

  const hide = () => {
    clearTimeout(hideTimer)
    element.classList.remove('is-visible')
  }

  return { say, hide }
}
