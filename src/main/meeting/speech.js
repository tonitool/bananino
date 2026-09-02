/*
 * Kept apart from whisper.js, which reaches Electron for the bundled binary path: this
 * filtering is the part with rules worth testing, so it must be importable on its own.
 */

/*
 * Whisper emits these for non-speech audio. Left in a transcript they read as though
 * somebody said them, so they are dropped.
 */
const NON_SPEECH = /^[([（].*[)\]）]$|^[*♪~\s.]*$/

export const isNonSpeech = (text) => NON_SPEECH.test(String(text ?? '').trim())

/*
 * Whisper hallucinates on near-silence, and what it produces is not plausible text but
 * one character repeated: a quiet room came back as "ᶠᶠᶠᶠᶠᶠᶠᶠᶠ", detected as Norwegian.
 * A level check alone did not catch it — that track measured well above the silence
 * floor — so the shape of the text is checked too. Real speech, in any language, does
 * not consist of a single repeated glyph.
 */
const MIN_DEGENERATE_LENGTH = 4
const MAX_DISTINCT_CHARACTERS = 2

export const isDegenerate = (text) => {
  const compact = String(text ?? '').replace(/\s/g, '')
  if (compact.length < MIN_DEGENERATE_LENGTH) return false
  return new Set(compact).size <= MAX_DISTINCT_CHARACTERS
}

export const dropNonSpeech = (segments) =>
  segments.filter((segment) => !isNonSpeech(segment.text) && !isDegenerate(segment.text))
