import { OPENROUTER } from '../constants.js'
import { LlmUnavailable, ask as askOllama, checkOllama } from './llm.js'
import { ask as askOpenRouter, readKey } from './openrouter.js'

/**
 * Chooses where the summary is generated, preferring the local model.
 *
 * Cloud is never a silent fallback: it requires `allowCloud`, and the chosen provider is
 * returned so the note and the UI can say plainly that the transcript left the machine.
 */
export const resolveProvider = async ({ allowCloud }) => {
  const ollama = await checkOllama()
  if (ollama.ok) {
    return { kind: 'ollama', model: ollama.model, label: `Ollama · ${ollama.model}`, isLocal: true }
  }

  if (!allowCloud) {
    return {
      kind: 'none',
      isLocal: true,
      reason: ollama.reason,
      hint: ollama.hint,
    }
  }

  if (!(await readKey())) {
    return {
      kind: 'none',
      isLocal: true,
      reason: `${ollama.reason} Cloud fallback is on, but no OpenRouter key is saved.`,
      hint: ollama.hint,
    }
  }

  return {
    kind: 'openrouter',
    label: `OpenRouter · ${OPENROUTER.model}`,
    isLocal: false,
    localReason: ollama.reason,
  }
}

/** An `ask` bound to a resolved provider, for the summariser to call. */
export const askVia = (provider) => {
  if (provider.kind === 'ollama') {
    return ({ system, prompt, signal }) =>
      askOllama({ model: provider.model, system, prompt, signal })
  }
  if (provider.kind === 'openrouter') return askOpenRouter
  return () => {
    throw new LlmUnavailable(provider.reason ?? 'No summariser is available.', {
      hint: provider.hint,
    })
  }
}
