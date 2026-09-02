import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isEntry } from './queueOps.js'

const FILE_NAME = 'moco-queue.json'
const MAX_ENTRIES = 500

const filePath = () => join(app.getPath('userData'), FILE_NAME)

export const readQueue = async () => {
  try {
    const parsed = JSON.parse(await readFile(filePath(), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_ENTRIES) : []
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[moco] queue unreadable:', error.message)
    return []
  }
}

export const writeQueue = async (entries) => {
  try {
    await writeFile(filePath(), JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2), 'utf8')
  } catch (error) {
    console.warn('[moco] queue could not be saved:', error.message)
  }
}
