import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export const DATA_FOLDER_NAME = 'bananino'

export const defaultDataDir = () => join(app.getPath('documents'), DATA_FOLDER_NAME)

export const notesDir = (dataDir) => join(dataDir, 'notes')
export const timeDir = (dataDir) => join(dataDir, 'time')

/** Every write goes through here, so a folder deleted mid-session heals on next use. */
export const ensureDir = async (dir) => {
  await mkdir(dir, { recursive: true })
  return dir
}
