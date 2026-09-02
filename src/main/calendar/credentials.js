import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILE_NAME = 'composio.key'

const filePath = () => join(app.getPath('userData'), FILE_NAME)

/**
 * The Composio API key follows the same rule as the MOCO key: encrypted with safeStorage
 * (the macOS login Keychain), never written in plain text, never logged, and sent only to
 * Composio itself.
 */
export const isSecureStorageAvailable = () => safeStorage.isEncryptionAvailable()

export const saveApiKey = async (apiKey) => {
  const trimmed = String(apiKey ?? '').trim()
  if (!trimmed) throw new Error('The API key is empty.')
  if (!isSecureStorageAvailable()) {
    throw new Error('Encrypted storage is unavailable, so the key cannot be saved safely.')
  }

  await writeFile(filePath(), safeStorage.encryptString(trimmed), { mode: 0o600 })
}

export const readApiKey = async () => {
  if (!isSecureStorageAvailable()) return null
  try {
    return safeStorage.decryptString(await readFile(filePath()))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[calendar] stored key could not be read:', error.message)
    }
    return null
  }
}

export const forgetApiKey = async () => {
  await rm(filePath(), { force: true })
}

export const hasApiKey = async () => (await readApiKey()) !== null
