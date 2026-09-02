import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OPENROUTER } from '../constants.js'
import { LlmUnavailable } from './llm.js'

const FILE_NAME = 'openrouter.key'
const filePath = () => join(app.getPath('userData'), FILE_NAME)

/** Encrypted with safeStorage, which on macOS is backed by the login Keychain. */
export const saveKey = async (key) => {
  const trimmed = String(key ?? '').trim()
  if (!trimmed) throw new Error('The API key is empty.')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encrypted storage is unavailable, so the key cannot be saved safely.')
  }
  await writeFile(filePath(), safeStorage.encryptString(trimmed), { mode: 0o600 })
}

export const readKey = async () => {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(await readFile(filePath()))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[meeting] stored OpenRouter key could not be read:', error.message)
    }
    return null
  }
}

export const forgetKey = () => rm(filePath(), { force: true })

/**
 * One chat turn against OpenRouter.
 *
 * This sends the transcript off the machine, so it is only ever reached when the user has
 * turned the cloud fallback on and Ollama is genuinely unavailable — and the note records
 * that it happened.
 */
export const ask = async ({ system, prompt, signal }) => {
  const key = await readKey()
  if (!key) throw new LlmUnavailable('No OpenRouter key is saved.')

  const response = await fetch(OPENROUTER.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    signal: signal ?? AbortSignal.timeout(OPENROUTER.timeoutMs),
    body: JSON.stringify({
      model: OPENROUTER.model,
      temperature: 0.2,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new LlmUnavailable(`OpenRouter returned HTTP ${response.status}. ${detail}`.trim())
  }

  const body = await response.json()
  if (body.error) throw new LlmUnavailable(body.error.message ?? String(body.error))
  return String(body.choices?.[0]?.message?.content ?? '').trim()
}
