import { formatMinutes } from '../storage/dates.js'

/**
 * What the buddy is told about itself and about your day, before you say anything.
 *
 * Pure string building on purpose: the prompt is the largest single influence on whether
 * this feature is any good, so it belongs somewhere a test can read it rather than buried
 * in a fetch call.
 */

/**
 * How many turns of history travel with each question.
 *
 * A local 3B model on a laptop is the constraint here, not politeness: every token of
 * history is re-read on every turn, so a long thread makes each answer slower than the
 * last. Ten turns is enough to follow a conversation and short enough to stay quick.
 */
export const HISTORY_TURNS = 10

export const SYSTEM = [
  'You are Bananino, a small desktop buddy that lives in the corner of a Mac.',
  'You help with time tracking, notes, the clipboard and meetings.',
  '',
  'How to answer:',
  '- Be brief. Two or three sentences unless asked for more; this is a small panel.',
  '- Use the facts under TODAY when they are relevant, and say so plainly.',
  '- If you do not know something, say you cannot see it rather than guessing.',
  '- No markdown headings, no bullet lists longer than three items, no emoji.',
  '',
  'How to act:',
  '- Use a tool when the user asks for something done. Do not describe the buttons they',
  '  could press instead; that is what the tool is for.',
  '- Some acts can be taken back and simply happen: the user sees a card with an Undo.',
  '- Some cannot, and are only offered: the user has to press the card before anything',
  '  happens. When a tool tells you it has offered something, say you have offered it.',
  '  Never say you did it.',
  '- One tool at a time, and only when you have what it needs. Ask for a missing task',
  '  name or date rather than inventing one — these end up in billable records.',
  '- After a tool answers, say what happened in one short sentence. Do not repeat the',
  '  card: the user can already see it.',
].join('\n')

/**
 * The day as a handful of lines the model can quote back.
 *
 * Only what the panel already knows: this reads the same snapshot the views render, so
 * the chat can never claim something the rest of the panel disagrees with. Absent facts
 * are left out entirely rather than sent as "none" — a wall of empty fields teaches a
 * small model to talk about empty fields.
 */
export const describeDay = (snapshot, now = new Date()) => {
  const lines = []
  const { timer, today, recentTasks = [], recentNotes = [], clips = [], moco, calendar } = snapshot

  lines.push(`Date: ${now.toDateString()}, time ${now.toTimeString().slice(0, 5)}.`)

  if (today) {
    lines.push(
      `Tracked today: ${formatMinutes(today.minutes)} across ${today.entries} ${
        today.entries === 1 ? 'entry' : 'entries'
      }. Notes written today: ${today.notes}.`,
    )
  }

  if (timer) {
    const minutes = Math.round((Date.now() - timer.startedAt) / 60_000)
    lines.push(
      `A timer is running right now on "${timer.task}", started ${minutes} minutes ago${
        timer.description ? ` (${timer.description})` : ''
      }.`,
    )
  } else {
    lines.push('No timer is running.')
  }

  if (recentTasks.length > 0) lines.push(`Recent tasks: ${recentTasks.join('; ')}.`)

  if (recentNotes.length > 0) {
    lines.push('Notes written today:')
    for (const note of recentNotes.slice(0, 6)) {
      lines.push(`- ${note.time} ${note.preview.replace(/\s+/g, ' ').slice(0, 120)}`)
    }
  }

  if (clips.length > 0) {
    lines.push(
      `Clipboard history holds ${clips.length} ${clips.length === 1 ? 'item' : 'items'}; the newest is "${clips[0].preview
        .replace(/\s+/g, ' ')
        .slice(0, 80)}".`,
    )
  }

  if (moco?.connected) {
    lines.push(
      `MOCO is connected as ${moco.subdomain}: ${moco.pending} entries queued to push, ${moco.failed} failed.`,
    )
  }

  const next = calendar?.upcoming?.[0]
  if (next) {
    const minutesAway = Math.round((next.startMs - Date.now()) / 60_000)
    lines.push(
      minutesAway > 0
        ? `Next meeting: "${next.title}" in ${minutesAway} minutes.`
        : `In a meeting now: "${next.title}".`,
    )
  }

  return `TODAY\n${lines.join('\n')}`
}

/**
 * One thread entry as the model sees it.
 *
 * An action becomes the pair the tool protocol expects: the assistant's own call, then the
 * result. Sending only the result would be cheaper and is what a naive port does, but it
 * leaves the model with an answer to a question it cannot see having asked — and models
 * then either repeat the call or narrate someone else's work as their own.
 */
const asProtocol = (entry) =>
  entry.role === 'action'
    ? [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: entry.call.name, arguments: entry.call.args } }],
        },
        { role: 'tool', content: entry.told },
      ]
    : [{ role: entry.role, content: entry.text }]

/**
 * The messages one turn sends: the buddy's brief, the day, then the recent conversation.
 *
 * The day is a system message rather than part of the brief so it can be rebuilt on every
 * turn — a timer that has been stopped mid-conversation must not still be running in the
 * transcript the model reads.
 */
export const buildMessages = ({ history, snapshot, now }) => [
  { role: 'system', content: SYSTEM },
  { role: 'system', content: describeDay(snapshot, now) },
  // An empty assistant bubble is the one still being streamed into; it says nothing yet.
  ...history
    .slice(-HISTORY_TURNS * 2)
    .filter((entry) => entry.role === 'action' || entry.text)
    .flatMap(asProtocol),
]
