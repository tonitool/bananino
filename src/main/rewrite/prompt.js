/**
 * What the buddy is told when it is asked to rewrite something you have selected.
 *
 * The whole feature lives or dies on one thing: what comes back must be *only the new
 * text*. It is going straight into someone's email over a selection they made, so a
 * model that opens with "Sure! Here's a friendlier version:" has not helped, it has
 * vandalised the sentence. Hence a brief that says so four different ways, and a parser
 * below that assumes the brief was ignored anyway.
 */

/** The buttons, because most rewrites are one of a handful of things. */
export const PRESETS = Object.freeze([
  { id: 'shorter', label: 'Shorter', instruction: 'Make it shorter and tighter. Keep every fact.' },
  { id: 'clearer', label: 'Clearer', instruction: 'Make it clearer and easier to read.' },
  { id: 'warmer', label: 'Friendlier', instruction: 'Make it warmer and friendlier, still professional.' },
  { id: 'formal', label: 'More formal', instruction: 'Make it more formal and business-like.' },
  { id: 'grammar', label: 'Fix grammar', instruction: 'Fix spelling, grammar and punctuation. Change nothing else — not the wording, not the tone.' },
  { id: 'english', label: 'To English', instruction: 'Translate it into natural English.' },
  { id: 'german', label: 'To German', instruction: 'Translate it into natural German.' },
])

/**
 * The longest selection accepted.
 *
 * Not a safety limit but a usefulness one: past a few pages a local model starts dropping
 * paragraphs rather than rewriting them, and silently returning two-thirds of someone's
 * document would be the worst possible failure for a tool that replaces text.
 */
export const MAX_SELECTION = 6000

/** How many versions to ask for. Three fits the popup and gives a real choice. */
export const VARIANTS = 3

/** The separator the model is asked for, and the one the parser trusts. */
const SEPARATOR = '---'

export const SYSTEM = [
  'You rewrite text that someone has selected on their Mac.',
  '',
  'Rules, in order of importance:',
  '- Reply with the rewritten text and nothing else. No preamble, no explanation, no',
  '  "here is", no quotation marks around it, no markdown fences.',
  `- Give ${VARIANTS} different versions, separated by a line containing only ${SEPARATOR}.`,
  '- Keep the original language unless you are asked to translate.',
  '- Keep the meaning, the facts, the names and the numbers. You are rewriting, not',
  '  inventing: never add a claim, a promise or a detail that was not there.',
  '- Match the register of what you are given — a Slack line stays a Slack line, an email',
  '  stays an email. Keep roughly the same length unless asked otherwise.',
  '- Preserve the shape: if it came as bullet points it goes back as bullet points, and',
  '  leading or trailing spaces belong to the sentence around it.',
].join('\n')

export const buildPrompt = ({ text, instruction }) =>
  [
    `Rewrite this text. ${String(instruction ?? '').trim() || 'Improve it.'}`,
    '',
    'The text:',
    String(text ?? ''),
  ].join('\n')

/** Chatter a model opens with when it has ignored the brief. */
const PREAMBLE = /^(sure|certainly|of course|here (are|is)|okay|ok)\b[^\n]*:\s*$/i

/** "1.", "1)", "Version 2:", "Option 3 —" at the start of a version. */
const NUMBERING = /^\s*(?:(?:version|option|variant)\s*)?\d+\s*[.)\]:—-]\s*/i

const FENCE = /^```[a-z]*\n([\s\S]*?)\n?```$/i

/**
 * One version, cleaned of whatever the model wrapped it in.
 *
 * Quotes are only stripped when they wrap the *whole* thing and the original was not
 * itself a quotation — otherwise "he said "no"" loses its punctuation.
 */
const tidy = (piece) => {
  let text = String(piece ?? '').trim()

  const fenced = FENCE.exec(text)
  if (fenced) text = fenced[1].trim()

  text = text.replace(NUMBERING, '')

  const wrapped = /^"([\s\S]+)"$/.exec(text) ?? /^“([\s\S]+)”$/.exec(text)
  if (wrapped && !wrapped[1].includes('"') && !wrapped[1].includes('”')) text = wrapped[1]

  return text.trim()
}

/**
 * The versions in a reply, however the model chose to lay them out.
 *
 * Written to be forgiving in one direction only: a version that survives here gets pasted
 * over someone's selection, so a line the model meant as commentary must not become one.
 * Anything it cannot split it treats as a single version — one good rewrite is a perfectly
 * fine answer, and three fabricated ones are not.
 */
export const parseVariants = (reply, { limit = VARIANTS } = {}) => {
  const body = String(reply ?? '')
    .split('\n')
    .filter((line, index) => !(index === 0 && PREAMBLE.test(line.trim())))
    .join('\n')

  const pieces = body.split(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m)

  const seen = new Set()
  const variants = []
  for (const piece of pieces) {
    const text = tidy(piece)
    if (!text || seen.has(text)) continue
    seen.add(text)
    variants.push(text)
    if (variants.length >= limit) break
  }

  return variants
}

/** What the popup shows above the versions, so a long selection is recognisable. */
export const preview = (text, length = 240) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}
