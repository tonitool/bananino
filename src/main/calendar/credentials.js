import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILE_NAME = 'calendar.url'

const filePath = () => join(app.getPath('userData'), FILE_NAME)

/**
 * A published calendar URL is a bearer secret: anyone holding it can read the calendar.
 * It gets the same treatment as the MOCO key — safeStorage (the login Keychain), never
 * plain text, never logged, and fetched only over HTTPS.
 */
export const isSecureStorageAvailable = () => safeStorage.isEncryptionAvailable()

export const saveFeedUrl = async (feedUrl) => {
  const trimmed = String(feedUrl ?? '').trim()
  if (!trimmed) throw new Error('The calendar link is empty.')
  if (!isSecureStorageAvailable()) {
    throw new Error('Encrypted storage is unavailable, so the link cannot be saved safely.')
  }

  await writeFile(filePath(), safeStorage.encryptString(trimmed), { mode: 0o600 })
}

export const readFeedUrl = async () => {
  if (!isSecureStorageAvailable()) return null
  try {
    return safeStorage.decryptString(await readFile(filePath()))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[calendar] stored feed link could not be read:', error.message)
    }
    return null
  }
}

export const forgetFeedUrl = async () => {
  await rm(filePath(), { force: true })
}

export const hasFeedUrl = async () => (await readFeedUrl()) !== null
