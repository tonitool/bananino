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
 * Whether a model in `ollama list` actually runs on this machine.
 *
 * Ollama's paid plan adds *cloud* models — `gpt-oss:120b-cloud`, `glm-4.6:cloud` and the
 * rest. They appear in the local daemon's own model list and are used through the same
 * API on the same localhost port, which is convenient and completely invisible: the
 * daemon forwards the request, prompt and all, to Ollama's servers.
 *
 * That matters here more than anywhere else in this app, because everything that talks to
 * Ollama does so on the promise that it stays on the machine. A cloud model is a fine
 * thing to choose — it is far better at deciding which tool to call — but it can only be
 * chosen deliberately, and it cannot be described as local. Hence a name test rather than
 * a note in a doc: they are also much bigger than anything a laptop would run, so they
 * would otherwise be picked by accident the moment someone subscribed.
 */
export const isCloudModel = (name) => /(?::|-)cloud$/i.test(String(name ?? ''))

/**
 * The best installed model that is small enough to actually finish.
 *
 * Size is a hard filter before preference: an oversized model is worse than a modest
 * one, because a summary that times out is no summary at all. If everything installed is
 * oversized, the smallest is used rather than refusing outright.
 *
 * `prefer` names one exactly — the user's own choice, which beats every heuristic here,
 * including the size limit and the cloud rule. `allowCloud` lets the automatic pick reach
 * for a cloud model, and defaults to off: see `isCloudModel`.
 */
export const pickModel = (installed, preference = OLLAMA.modelPreference, options = {}) => {
  const { prefer = '', allowCloud = false } = options
  const models = installed
    .map((entry) => (typeof entry === 'string' ? { name: entry, size: 0 } : entry))
    .filter((model) => model.name)
  if (models.length === 0) return null

  const chosen = models.find((model) => model.name === prefer)
  if (chosen) return chosen.name

  const local = allowCloud ? models : models.filter((model) => !isCloudModel(model.name))
  if (local.length === 0) return null

  const family = (name) => String(name).split(':')[0]
  const affordable = local.filter((model) => (model.size ?? 0) <= OLLAMA.maxModelBytes)
  const pool = affordable.length > 0 ? affordable : [...local].sort((a, b) => a.size - b.size)

  for (const wanted of preference) {
    const match = pool.find((model) => model.name === wanted || family(model.name) === wanted)
    if (match) return match.name
  }
  return pool[0].name
}

/**
 * What is installed and which of it to use. `prefer` and `allowCloud` are passed straight
 * to `pickModel`; the default is the local-only pick every caller had before.
 */
export const checkOllama = async ({ prefer = '', allowCloud = false } = {}) => {
  try {
    const response = await fetch(`${OLLAMA.url}/api/tags`, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const installed = (await response.json()).models ?? []
    const available = installed.map((entry) => ({
      name: entry.name,
      isCloud: isCloudModel(entry.name),
    }))
    const model = pickModel(
      installed.map((entry) => ({ name: entry.name, size: entry.size })),
      OLLAMA.modelPreference,
      { prefer, allowCloud },
    )

    if (!model) {
      const onlyCloud = available.length > 0 && available.every((entry) => entry.isCloud)
      return {
        ok: false,
        reason: onlyCloud
          ? 'The only models installed are Ollama cloud models, which do not run on this Mac.'
          : 'Ollama is running but has no models installed.',
        hint: onlyCloud ? undefined : `ollama pull ${OLLAMA.modelPreference[0]}`,
        available,
      }
    }
    return { ok: true, model, isLocal: !isCloudModel(model), available }
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
 *
 * Returns the finished answer *and* any tools the model asked for, because a turn can be
 * both: models routinely say "let me check" and call something in the same message.
 */
export const streamChat = async ({ model, messages, tools, signal, onText }) => {
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
      ...(tools?.length ? { tools } : {}),
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
  const calls = []

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
      // Ollama sends a tool call whole rather than as a stream of JSON fragments, so
      // there is nothing to reassemble here — only to collect.
      for (const call of event.message?.tool_calls ?? []) {
        if (call?.function?.name) calls.push(call.function)
      }
    }
  }

  return { text: visibleSoFar(answer), calls }
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
