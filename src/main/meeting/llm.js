import { OLLAMA } from '../constants.js'

export class LlmUnavailable extends Error {
  constructor(message, { hint } = {}) {
    super(message)
    this.name = 'LlmUnavailable'
    this.hint = hint
  }
}

/** Reasoning models leak their scratchpad if asked nicely; strip it either way. */
const stripThinking = (text) =>
  text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*<\/?think>\s*$/gim, '')
    .trim()

/**
 * The best installed model that is small enough to actually finish.
 *
 * Size is a hard filter before preference: an oversized model is worse than a modest
 * one, because a summary that times out is no summary at all. If everything installed is
 * oversized, the smallest is used rather than refusing outright.
 */
export const pickModel = (installed, preference = OLLAMA.modelPreference) => {
  const models = installed
    .map((entry) => (typeof entry === 'string' ? { name: entry, size: 0 } : entry))
    .filter((model) => model.name)
  if (models.length === 0) return null

  const family = (name) => String(name).split(':')[0]
  const affordable = models.filter((model) => (model.size ?? 0) <= OLLAMA.maxModelBytes)
  const pool = affordable.length > 0 ? affordable : [...models].sort((a, b) => a.size - b.size)

  for (const wanted of preference) {
    const match = pool.find((model) => model.name === wanted || family(model.name) === wanted)
    if (match) return match.name
  }
  return pool[0].name
}

export const checkOllama = async () => {
  try {
    const response = await fetch(`${OLLAMA.url}/api/tags`, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const installed = (await response.json()).models ?? []
    const names = installed.map((entry) => entry.name)
    const model = pickModel(installed.map((entry) => ({ name: entry.name, size: entry.size })))

    if (!model) {
      return {
        ok: false,
        reason: 'Ollama is running but has no models installed.',
        hint: `ollama pull ${OLLAMA.modelPreference[0]}`,
        available: names,
      }
    }
    return { ok: true, model, available: names }
  } catch (error) {
    return {
      ok: false,
      reason: `Ollama is not reachable at ${OLLAMA.url}.`,
      hint: 'Start it with: ollama serve',
      cause: error.message,
    }
  }
}

/**
 * The visible part of a partly-streamed answer.
 *
 * `stripThinking` only removes a closed `<think>` block, which is right for a finished
 * answer and wrong mid-stream: while the model is still reasoning the opening tag has no
 * partner yet, and the scratchpad would stream straight into the panel. So an unclosed
 * block is treated as running to the end of what has arrived so far.
 */
export const visibleSoFar = (text) =>
  stripThinking(text.replace(/<think>(?![\s\S]*<\/think>)[\s\S]*$/i, ''))

/**
 * A streamed chat turn, for a conversation rather than a summary.
 *
 * `ask` below waits for the whole answer, which is the right shape for writing up a
 * meeting — nobody watches that happen. In a chat it is the wrong shape entirely: a local
 * model takes seconds to finish a paragraph, and a panel that shows nothing for those
 * seconds reads as broken. So the tokens arrive as they are generated.
 *
 * `onText` is handed the whole visible answer so far, not the newest fragment. Callers
 * therefore never have to reassemble it, and dropping a reasoning scratchpad — which can
 * only be judged from the text around it — stays this function's problem.
 */
export const streamChat = async ({ model, messages, signal, onText }) => {
  const response = await fetch(`${OLLAMA.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      think: false,
      options: { temperature: 0.4 },
      messages,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new LlmUnavailable(`Ollama returned HTTP ${response.status}. ${detail}`.trim())
  }

  /*
   * Newline-delimited JSON, one object per token, and a chunk can split a line in half —
   * so the tail is held back until its newline arrives rather than parsed hopefully.
   */
  const decoder = new TextDecoder()
  let pending = ''
  let answer = ''

  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        // A malformed line is not worth failing a whole answer over.
        continue
      }
      if (event.error) throw new LlmUnavailable(event.error)
      if (event.message?.content) {
        answer += event.message.content
        onText?.(visibleSoFar(answer))
      }
    }
  }

  return visibleSoFar(answer)
}

/**
 * One non-streaming chat turn. Everything here runs on the machine that recorded the
 * meeting, which is the whole point — the transcript never leaves it.
 */
export const ask = async ({ model, system, prompt, signal }) => {
  const response = await fetch(`${OLLAMA.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: signal ?? AbortSignal.timeout(OLLAMA.timeoutMs),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      options: { temperature: 0.2 },
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new LlmUnavailable(`Ollama returned HTTP ${response.status}. ${detail}`.trim())
  }

  const body = await response.json()
  if (body.error) throw new LlmUnavailable(body.error)

  return stripThinking(body.message?.content ?? '')
}
