import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORNERS,
  COSTUME_MENU,
  DEFAULT_CORNER,
  DEFAULT_SIZE_KEY,
  MAX_RECENT_TASKS,
  WINDOW_SIZES,
} from './constants.js'
import { defaultDataDir } from './storage/paths.js'

const FILE_NAME = 'pet-state.json'

const filePath = () => join(app.getPath('userData'), FILE_NAME)

const isPosition = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)

const isActiveTimer = (value) =>
  value !== null &&
  typeof value === 'object' &&
  typeof value.task === 'string' &&
  Number.isFinite(value.startedAt)

/**
 * Nothing here is trusted: the file sits in a folder the user can open and edit, and a
 * bad value would otherwise reach BrowserWindow or the filesystem directly.
 */
const sanitize = (raw) => ({
  sizeKey: Object.hasOwn(WINDOW_SIZES, raw?.sizeKey) ? raw.sizeKey : DEFAULT_SIZE_KEY,
  corner: Object.hasOwn(CORNERS, raw?.corner) ? raw.corner : DEFAULT_CORNER,
  dataDir: typeof raw?.dataDir === 'string' && raw.dataDir ? raw.dataDir : defaultDataDir(),
  alwaysVisible: raw?.alwaysVisible === true,
  captureClipboard: raw?.captureClipboard !== false,
  // Off by default: switching it on is what prompts for Automation permission, which is
  // far less alarming when it happens because you just asked for the feature.
  showNowPlaying: raw?.showNowPlaying === true,
  // Meeting transcription always runs locally; this only governs whether a *summary*
  // may fall back to the cloud, so it defaults to off.
  meetingCloudFallback: raw?.meetingCloudFallback === true,
  meetingUseMic: raw?.meetingUseMic !== false,
  costume: COSTUME_MENU.some(([name]) => name === raw?.costume) ? raw.costume : 'none',
  mocoSubdomain: typeof raw?.mocoSubdomain === 'string' ? raw.mocoSubdomain : '',
  // Composio bookkeeping — identifiers, not secrets. The API key itself lives in
  // safeStorage; these only let a relaunch find the same connection again.
  calendarAuthConfigId:
    typeof raw?.calendarAuthConfigId === 'string' ? raw.calendarAuthConfigId : '',
  calendarAccountId: typeof raw?.calendarAccountId === 'string' ? raw.calendarAccountId : '',
  // Off by default: rounding up bills more time than was worked.
  mocoRoundTo: [0, 5, 15].includes(raw?.mocoRoundTo) ? raw.mocoRoundTo : 0,
  taskBindings: sanitizeBindings(raw?.taskBindings),
  position: isPosition(raw?.position) ? [...raw.position] : null,
  activeTimer: isActiveTimer(raw?.activeTimer)
    ? {
        task: raw.activeTimer.task,
        startedAt: raw.activeTimer.startedAt,
        binding: sanitizeBindings({ t: raw.activeTimer.binding }).t ?? null,
        description:
          typeof raw.activeTimer.description === 'string' ? raw.activeTimer.description : '',
      }
    : null,
  recentTasks: Array.isArray(raw?.recentTasks)
    ? raw.recentTasks.filter((task) => typeof task === 'string' && task).slice(0, MAX_RECENT_TASKS)
    : [],
})

export const readSettings = () => {
  try {
    return sanitize(JSON.parse(readFileSync(filePath(), 'utf8')))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[${FILE_NAME}] unreadable, falling back to defaults:`, error.message)
    }
    return sanitize({})
  }
}

/** Returns the merged settings so callers keep working with a value, not a side effect. */
export const writeSettings = (patch) => {
  const next = sanitize({ ...readSettings(), ...patch })
  try {
    writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    console.warn(`[${FILE_NAME}] could not be saved:`, error.message)
  }
  return next
}

/**
 * Which MOCO project/task each local task name maps to. Hand-edited or stale files must
 * not be able to put a non-numeric id into an API payload.
 */
const sanitizeBindings = (raw) => {
  if (raw === null || typeof raw !== 'object') return {}

  return Object.fromEntries(
    Object.entries(raw)
      .filter(
        ([name, binding]) =>
          typeof name === 'string' &&
          name.length > 0 &&
          Number.isFinite(binding?.projectId) &&
          Number.isFinite(binding?.taskId),
      )
      .map(([name, binding]) => [
        name,
        {
          projectId: binding.projectId,
          taskId: binding.taskId,
          label: typeof binding.label === 'string' ? binding.label : name,
        },
      ]),
  )
}

export const withBinding = (taskBindings, task, binding) =>
  binding ? { ...taskBindings, [task]: binding } : taskBindings

export const withRecentTask = (recentTasks, task) =>
  [task, ...recentTasks.filter((existing) => existing !== task)].slice(0, MAX_RECENT_TASKS)
