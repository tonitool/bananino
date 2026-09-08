import { LlmUnavailable } from '../meeting/llm.js'

/**
 * Streaming chat with tools over the OpenAI-compatible wire (OpenRouter today).
 *
 * Deliberately electron-free — no key reading, no app paths — so the whole of it is
 * testable under plain node. The key and the URL arrive as arguments from
 * meeting/openrouter.js, which is the one place allowed to know where the key lives.
 *
 * The wire speaks in server-sent events: one `data:` line per delta, a `[DONE]` sentinel,
 * and tool calls that arrive as JSON *fragments* — the name in the first delta of a call,
 * its `arguments` string split across the rest. Calls are therefore keyed by their stream
 * index and assembled whole; a half-concatenated arguments string is not JSON, and parsing
 * hopefully is how tool calls get silently dropped.
 */
export const streamChat = async ({ url, key, model, messages, tools, signal, onText }) => {
  if (!key) throw new LlmUnavailable('No OpenRouter key is saved.')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.4,
      messages,
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new LlmUnavailable(`OpenRouter returned HTTP ${response.status}. ${detail}`.trim())
  }

  let pending = ''
  let answer = ''
  const callsByIndex = new Map()
  const decoder = new TextDecoder()

  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue

      let event
      try {
        event = JSON.parse(data)
      } catch {
        // A malformed frame is not worth failing a whole answer over.
        continue
      }
      if (event.error) throw new LlmUnavailable(event.error.message ?? String(event.error))

      for (const choice of event.choices ?? []) {
        const delta = choice.delta ?? {}
        if (delta.content) {
          answer += delta.content
          onText?.(visibleSoFar(answer))
        }
        for (const call of delta.tool_calls ?? []) {
          const index = typeof call.index === 'number' ? call.index : callsByIndex.size
          const existing = callsByIndex.get(index) ?? { name: '', argsJson: '' }
          callsByIndex.set(index, {
            name: call.function?.name ?? existing.name,
            argsJson: existing.argsJson + (call.function?.arguments ?? ''),
          })
        }
      }
    }
  }

  return {
    text: visibleSoFar(answer),
    calls: [...callsByIndex.values()]
      .filter((call) => call.name)
      .map((call) => ({ name: call.name, arguments: call.argsJson })),
  }
}

/** The scratchpad-dropping rule the Ollama twin applies; reasoning looks alike here too. */
const visibleSoFar = (text) =>
  text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>(?![\s\S]*<\/think>)[\s\S]*$/i, '')
    .replace(/^\s*<\/?think>\s*$/gim, '')
    .trim()
