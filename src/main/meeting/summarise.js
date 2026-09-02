/** Roughly 12k characters keeps a chunk comfortably inside a small model's context. */
const CHUNK_CHARS = 12_000

const SYSTEM = `You summarise meeting transcripts. You are precise and you never invent
facts, names, numbers, or commitments that are not in the transcript. If something is
unclear, say so rather than guessing.`

const NOTE_TEMPLATE = `Produce exactly these sections in Markdown, nothing before or after:

## Summary
Three to six bullet points, in English.

## Zusammenfassung
The same points, in German.

## Decisions
Bullet points of anything that was actually decided. Write "None recorded." if nothing was.

## Action items
Markdown task list. Format each as "- [ ] Owner — task — deadline". Use "Unassigned" or
"No deadline" where the transcript does not say. Write "None recorded." if there are none.

## Open questions
Anything left unresolved. Write "None recorded." if there are none.`

const asScript = (segments) =>
  segments.map((segment) => `${segment.speaker}: ${segment.text}`).join('\n')

const chunk = (text) => {
  if (text.length <= CHUNK_CHARS) return [text]

  const lines = text.split('\n')
  const chunks = []
  let current = ''

  for (const line of lines) {
    if (current.length + line.length + 1 > CHUNK_CHARS && current) {
      chunks.push(current)
      current = ''
    }
    current += `${line}\n`
  }
  if (current.trim()) chunks.push(current)
  return chunks
}

/**
 * Map-reduce so a two-hour meeting does not silently get truncated to whatever fits in
 * the context window. Short transcripts take the single-pass path.
 */
/*
 * `ask` is injected rather than chosen here: the caller decides which provider runs, so
 * a transcript can never reach the cloud as a side effect of summarising.
 */
export const summariseMeeting = async ({ ask, segments, title, signal }) => {
  const script = asScript(segments)
  if (!script.trim()) return null

  const pieces = chunk(script)
  const context = title ? `The meeting is titled "${title}".` : ''

  if (pieces.length === 1) {
    return ask({
      system: SYSTEM,
      signal,
      prompt: `${context}\n\nTranscript:\n\n${pieces[0]}\n\n${NOTE_TEMPLATE}`,
    })
  }

  const partials = []
  for (const [index, piece] of pieces.entries()) {
    partials.push(
      await ask({
        system: SYSTEM,
        signal,
        prompt:
          `${context}\n\nThis is part ${index + 1} of ${pieces.length} of a longer ` +
          `transcript. Summarise only what is in this part, as terse English bullet ` +
          `points covering topics, decisions, and commitments.\n\n${piece}`,
      }),
    )
  }

  return ask({
    system: SYSTEM,
    signal,
    prompt:
      `${context}\n\nBelow are ordered partial summaries of one meeting. Combine them, ` +
      `removing repetition and keeping every decision and commitment.\n\n` +
      partials.map((part, i) => `Part ${i + 1}:\n${part}`).join('\n\n') +
      `\n\n${NOTE_TEMPLATE}`,
  })
}
