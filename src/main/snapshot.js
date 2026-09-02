import { CALENDAR } from './constants.js'
import { countNotesToday, readNotesToday } from './storage/notes.js'
import { readDayTotals } from './storage/timeLog.js'

const CLIP_PREVIEW_LENGTH = 400
const NOTE_PREVIEW_LENGTH = 240

/** Clip bodies stay in the main process; the panel only ever sees a short preview. */
const toClipPreview = (clip) => ({
  id: clip.id,
  preview: clip.text.slice(0, CLIP_PREVIEW_LENGTH),
  length: clip.text.length,
  at: clip.at,
  pinned: clip.pinned,
})

/**
 * One object describing everything the panel renders. Pushing a whole snapshot on every
 * change keeps the renderer free of its own copy of the truth.
 */
export const buildSnapshot = async ({ settings, clips, moco, nowPlaying, meeting, calendar }) => {
  const { dataDir } = settings

  const [today, notesToday, recentNotes] = await Promise.all([
    readDayTotals({ dataDir }).catch(reportAndDefault('time totals', { minutes: 0, count: 0 })),
    countNotesToday({ dataDir }).catch(reportAndDefault('note count', 0)),
    readNotesToday({ dataDir, limit: 8 }).catch(reportAndDefault('recent notes', [])),
  ])

  return {
    timer: settings.activeTimer,
    recentTasks: settings.recentTasks,
    bindings: settings.taskBindings,
    today: { minutes: today.minutes, entries: today.count, notes: notesToday },
    recentNotes: recentNotes.map((note) => ({
      index: note.index,
      time: note.time,
      preview: note.text.slice(0, NOTE_PREVIEW_LENGTH),
    })),
    clips: clips.map(toClipPreview),
    moco: moco ?? null,
    nowPlaying: nowPlaying ?? null,
    meeting: meeting ?? null,
    calendar: calendar ?? null,
    settings: {
      corner: settings.corner,
      sizeKey: settings.sizeKey,
      alwaysVisible: settings.alwaysVisible,
      captureClipboard: settings.captureClipboard,
      showNowPlaying: settings.showNowPlaying,
      meetingCloudFallback: settings.meetingCloudFallback,
      meetingUseMic: settings.meetingUseMic,
      costume: settings.costume,
      dataDir: settings.dataDir,
      // Single source for the renderer's clock-prop trigger: the main process owns it.
      calendarClockLeadMinutes: CALENDAR.clockLeadMinutes,
    },
  }
}

const reportAndDefault = (label, fallback) => (error) => {
  console.error(`[snapshot] could not read ${label}:`, error)
  return fallback
}
