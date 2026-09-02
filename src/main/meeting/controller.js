import { checkBinaries } from './binaries.js'
import { createMeetingSession } from './session.js'

const IDLE = Object.freeze({ phase: 'idle' })

/**
 * Holds the state of the current meeting for the panel and the tray.
 *
 * Progress is kept here rather than in the renderer because a meeting outlives any one
 * panel: the window is closed most of the time, and processing keeps running after it is.
 */
export const createMeetingController = ({ getSettings, mic, onChange = () => {}, say }) => {
  let state = IDLE

  const set = (next) => {
    state = { ...state, ...next }
    onChange()
  }

  const session = createMeetingSession({
    dataDir: getSettings().dataDir,
    mic,
    onProgress: (event) => {
      if (event.phase === 'warning') return
      set(event)
    },
  })

  const start = async ({ title = '' } = {}) => {
    if (session.isRecording()) return { ok: false, error: 'A meeting is already recording.' }

    const binaries = await checkBinaries()
    const missing = Object.entries(binaries).filter(([, info]) => !info.ok)
    if (missing.length > 0) {
      const error = `This build is missing its ${missing.map(([name]) => name).join(' and ')} helper.`
      set({ phase: 'idle', error })
      return { ok: false, error }
    }

    try {
      set({ phase: 'recording', seconds: 0, levels: {}, error: null, note: null, warnings: [] })
      await session.start({ title, withMic: getSettings().meetingUseMic !== false })
      say?.('Listening to the meeting.', 'happy')
      return { ok: true }
    } catch (error) {
      /*
       * Overwhelmingly the cause is the missing permission, and macOS reports it as a
       * bare Core Audio status code, so the message says what to actually do about it.
       */
      set({ phase: 'idle', error: error.message })
      say?.('I could not hear the meeting.', 'sad')
      return { ok: false, error: error.message }
    }
  }

  const stop = async () => {
    if (!session.isRecording()) return { ok: false, error: 'No meeting is recording.' }
    try {
      const result = await session.stop({
        allowCloud: getSettings().meetingCloudFallback === true,
      })
      if (result.note) say?.('Meeting note saved.', 'happy')
      else say?.('Nothing was recorded to write up.', 'sad')
      return { ok: true, ...result }
    } catch (error) {
      set({ phase: 'idle', error: error.message })
      say?.('The meeting could not be written up.', 'sad')
      return { ok: false, error: error.message }
    }
  }

  const cancel = async () => {
    await session.cancel()
    set(IDLE)
    return { ok: true }
  }

  return {
    start,
    stop,
    cancel,
    isRecording: () => session.isRecording(),
    isBusy: () => state.phase !== 'idle' && state.phase !== 'done',
    status: () => state,
  }
}
