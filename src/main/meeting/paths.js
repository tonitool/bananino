import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isoDate } from '../storage/dates.js'

const pad = (n) => String(n).padStart(2, '0')

export const meetingsDir = (dataDir) => join(dataDir, 'meetings')

/**
 * Slug kept conservative: these become folder names on a case-insensitive filesystem.
 *
 * Combining marks are stripped after decomposition and ß is spelled out, so German
 * titles survive: without that, NFKD turns "Ü" into "U" plus a combining diaeresis and
 * the mark becomes a separator — "Über uns" came out as "u-ber-uns".
 */
export const slugify = (title) =>
  String(title ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')

export const sessionFolderName = (title, at) => {
  const stamp = `${isoDate(at)}-${pad(at.getHours())}${pad(at.getMinutes())}`
  const slug = slugify(title)
  return slug ? `${stamp}-${slug}` : stamp
}

export const createSessionDir = async ({ dataDir, title, at }) => {
  const dir = join(meetingsDir(dataDir), sessionFolderName(title, at))
  await mkdir(dir, { recursive: true })
  return dir
}
