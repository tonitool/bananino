import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clockTime, isoDate, isoMonth } from './dates.js'
import { parseCsvRecords, toRow } from './csv.js'
import { ensureDir, timeDir } from './paths.js'

export const HEADER = Object.freeze(['date', 'start', 'end', 'minutes', 'task'])
export const MAX_TASK_LENGTH = 200
export const UNTITLED_TASK = 'Untitled'

const logFile = (dataDir, date) => join(timeDir(dataDir), `${isoMonth(date)}.csv`)

export const normaliseTask = (task) => {
  const trimmed = String(task ?? '').trim().replace(/\s+/g, ' ')
  return trimmed.slice(0, MAX_TASK_LENGTH) || UNTITLED_TASK
}

/** One CSV per month: small enough to read whole, long enough to stay tidy. */
const appendRow = async ({ dataDir, at, cells }) => {
  const dir = await ensureDir(timeDir(dataDir))
  const file = join(dir, `${isoMonth(at)}.csv`)

  const exists = await readFile(file, 'utf8').then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false
      throw error
    },
  )

  if (!exists) await writeFile(file, `${toRow(HEADER)}\n`, 'utf8')
  await appendFile(file, `${toRow(cells)}\n`, 'utf8')
  return { file }
}

export const appendTimeEntry = async ({ dataDir, task, startedAt, endedAt }) => {
  const minutes = Math.max(0, Math.round((endedAt - startedAt) / 60_000))
  const { file } = await appendRow({
    dataDir,
    at: startedAt,
    cells: [
      isoDate(startedAt),
      clockTime(startedAt),
      clockTime(endedAt),
      String(minutes),
      normaliseTask(task),
    ],
  })
  return { file, minutes }
}

/**
 * Time entered after the fact. Start and end are left blank rather than invented — the
 * duration is known, the clock times are not, and a made-up 09:00 would be a false record.
 */
export const appendManualTimeEntry = async ({ dataDir, task, date, minutes }) => {
  const { file } = await appendRow({
    dataDir,
    at: date,
    cells: [isoDate(date), '', '', String(minutes), normaliseTask(task)],
  })
  return { file, minutes }
}

export const readMonthEntries = async ({ dataDir, at = new Date() }) => {
  const text = await readFile(logFile(dataDir, at), 'utf8').catch(() => '')
  return parseCsvRecords(text, HEADER)
}

export const readDayTotals = async ({ dataDir, at = new Date() }) => {
  const today = isoDate(at)
  const entries = (await readMonthEntries({ dataDir, at })).filter((e) => e.date === today)
  const minutes = entries.reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0)
  return { minutes, count: entries.length, entries }
}
