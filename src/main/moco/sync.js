import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isoDate } from '../storage/dates.js'
import { flattenProjects, relabel, searchTasks } from './catalogue.js'
import { createActivity, normaliseSubdomain, testConnection } from './client.js'
import { forgetApiKey, isSecureStorageAvailable, readApiKey, saveApiKey } from './credentials.js'
import { readQueue, writeQueue } from './queue.js'
import { roundMinutesUp } from './rounding.js'
import { addEntry, markFailed, removeEntries, toActivity, toHours } from './queueOps.js'

const CATALOGUE_FILE = 'moco-catalogue.json'
const CATALOGUE_MAX_AGE_MS = 12 * 60 * 60 * 1000

const cataloguePath = () => join(app.getPath('userData'), CATALOGUE_FILE)

/**
 * Owns the MOCO connection, the cached task catalogue, and the queue of entries waiting to
 * be pushed.
 *
 * Nothing reaches MOCO on its own. Stopping a timer only ever queues; the push is an
 * explicit action, because these become billable records and a mistyped entry is much
 * easier to fix before it is submitted than after.
 */
export const createMocoSync = ({ getSettings, saveSettings, onChange }) => {
  let entries = []
  let catalogue = []
  let catalogueFetchedAt = 0
  let connected = false
  let lastError = null

  const notify = () => onChange?.(status())

  const status = () => ({
    available: isSecureStorageAvailable(),
    connected,
    subdomain: getSettings().mocoSubdomain ?? '',
    taskCount: catalogue.length,
    pending: entries.length,
    failed: entries.filter((entry) => entry.error).length,
    lastError,
  })

  const credentials = async () => {
    const apiKey = await readApiKey()
    const subdomain = getSettings().mocoSubdomain
    if (!apiKey || !subdomain) return null
    return { apiKey, subdomain }
  }

  const loadCatalogue = async () => {
    try {
      const cached = JSON.parse(await readFile(cataloguePath(), 'utf8'))
      catalogue = (Array.isArray(cached?.tasks) ? cached.tasks : []).map(relabel)
      catalogueFetchedAt = Number(cached?.fetchedAt) || 0
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[moco] catalogue unreadable:', error.message)
      catalogue = []
    }
  }

  const storeCatalogue = async () => {
    try {
      await writeFile(
        cataloguePath(),
        JSON.stringify({ fetchedAt: catalogueFetchedAt, tasks: catalogue }),
        'utf8',
      )
    } catch (error) {
      console.warn('[moco] catalogue could not be saved:', error.message)
    }
  }

  const start = async () => {
    entries = await readQueue()
    await loadCatalogue()
    connected = (await credentials()) !== null
    notify()

    // A stale catalogue is refreshed quietly; failing that is not worth interrupting for.
    if (connected && Date.now() - catalogueFetchedAt > CATALOGUE_MAX_AGE_MS) {
      refreshCatalogue().catch((error) => console.warn('[moco] refresh skipped:', error.message))
    }
  }

  const connect = async ({ subdomain, apiKey }) => {
    const cleaned = normaliseSubdomain(subdomain)
    // Verified before the key is stored, so a bad key is never persisted.
    const { projects } = await testConnection({ subdomain: cleaned, apiKey })

    await saveApiKey(apiKey)
    saveSettings({ mocoSubdomain: cleaned })

    catalogue = flattenProjects(projects)
    catalogueFetchedAt = Date.now()
    await storeCatalogue()

    connected = true
    lastError = null
    notify()
    return status()
  }

  const disconnect = async () => {
    await forgetApiKey()
    saveSettings({ mocoSubdomain: '' })
    catalogue = []
    catalogueFetchedAt = 0
    connected = false
    lastError = null
    await storeCatalogue()
    notify()
  }

  const refreshCatalogue = async () => {
    const auth = await credentials()
    if (!auth) throw new Error('MOCO is not connected.')

    const { projects } = await testConnection(auth)
    catalogue = flattenProjects(projects)
    catalogueFetchedAt = Date.now()
    await storeCatalogue()
    notify()
    return catalogue.length
  }

  /** Called when a timer stops. Unbound tasks stay local and are never queued. */
  const enqueue = async ({ task, binding, startedAt, endedAt, description }) => {
    if (!binding) return null

    const seconds = Math.max(0, (endedAt - startedAt) / 1000)
    const minutes = roundMinutesUp(seconds / 60, getSettings().mocoRoundTo)
    const entry = {
      id: randomUUID(),
      date: isoDate(new Date(startedAt)),
      projectId: binding.projectId,
      taskId: binding.taskId,
      hours: toHours(minutes * 60),
      // What was actually done; MOCO already knows the project and task from the ids.
      description: (description ?? '').trim() || task,
      label: binding.label,
      queuedAt: Date.now(),
    }

    entries = addEntry(entries, entry)
    await writeQueue(entries)
    notify()
    return entry
  }

  /** Time entered after the fact: the duration is given rather than measured. */
  const enqueueManual = async ({ task, binding, date, minutes, description }) => {
    if (!binding) return null

    const entry = {
      id: randomUUID(),
      date: isoDate(date),
      projectId: binding.projectId,
      taskId: binding.taskId,
      hours: toHours(roundMinutesUp(minutes, getSettings().mocoRoundTo) * 60),
      description: (description ?? '').trim() || task,
      label: binding.label,
      queuedAt: Date.now(),
      manual: true,
    }

    entries = addEntry(entries, entry)
    await writeQueue(entries)
    notify()
    return entry
  }

  const push = async () => {
    const auth = await credentials()
    if (!auth) throw new Error('MOCO is not connected.')
    if (entries.length === 0) return { sent: 0, failed: 0 }

    const sent = []
    let failed = 0

    // Sequential on purpose: a rate limit part-way through should stop, not stampede.
    for (const entry of [...entries]) {
      try {
        await createActivity({ ...auth, activity: toActivity(entry) })
        sent.push(entry.id)
      } catch (error) {
        failed += 1
        entries = markFailed(entries, entry.id, error.message)
        lastError = error.message
        if (error.status === 429 || error.status === 401 || error.status === 403) break
      }
    }

    entries = removeEntries(entries, sent)
    await writeQueue(entries)
    if (failed === 0) lastError = null
    notify()

    return { sent: sent.length, failed }
  }

  const discard = async (id) => {
    entries = removeEntries(entries, [id])
    await writeQueue(entries)
    notify()
  }

  return {
    start,
    connect,
    disconnect,
    refreshCatalogue,
    enqueue,
    enqueueManual,
    push,
    discard,
    status,
    isConnected: () => connected,
    pendingEntries: () => entries,
    search: (query, limit) => searchTasks(catalogue, query, limit),
  }
}
