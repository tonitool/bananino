import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clockTime, formatDuration, longDate } from '../storage/dates.js'

export const NOTE_FILE = 'note.md'

const stamp = (ms, startedAt) => clockTime(new Date(startedAt.getTime() + ms))

const transcriptLines = (segments, startedAt) =>
  segments
    .map((segment) => `**${stamp(segment.fromMs, startedAt)} · ${segment.speaker}** ${segment.text}`)
    .join('\n\n')

/**
 * The note is written even when the language model is unavailable — a timestamped,
 * speaker-labelled transcript is already most of the value, and losing it because a
 * summariser was offline would be indefensible.
 */
export const composeNote = ({ title, startedAt, endedAt, languages, segments, summary, warnings }) => {
  const speakers = [...new Set(segments.map((s) => s.speaker))]

  const parts = [
    `# ${title || 'Meeting'}`,
    '',
    `${longDate(startedAt)} · ${clockTime(startedAt)}–${clockTime(endedAt)} · ${formatDuration(endedAt - startedAt)}`,
    `Languages: ${languages.join(', ') || 'unknown'} · Speakers: ${speakers.join(', ') || 'none'}`,
    '',
  ]

  if (warnings?.length) {
    parts.push('> [!warning]', ...warnings.map((line) => `> ${line}`), '')
  }

  if (summary) parts.push(summary.trim(), '')

  parts.push(
    '## Transcript',
    '',
    segments.length > 0 ? transcriptLines(segments, startedAt) : '_No speech was detected._',
    '',
  )

  return parts.join('\n')
}

export const writeNote = async ({ dir, markdown }) => {
  const path = join(dir, NOTE_FILE)
  await writeFile(path, markdown, 'utf8')
  return path
}
