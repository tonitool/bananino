import { MEETING } from '../constants.js'
import { startCapture } from './capture.js'
import { createSessionDir } from './paths.js'
import { processRecording } from './process.js'

/**
 * One meeting, from pressing record to a written note.
 *
 * `onProgress` reports each phase so the UI can say what is happening; a meeting can run
 * for hours and then take minutes to process, and silence there reads as a hang.
 */
export const createMeetingSession = ({ dataDir, mic, onProgress = () => {} }) => {
  let active = null

  const phase = (name, detail = {}) => onProgress({ phase: name, ...detail })

  const start = async ({ title = '', withMic = true, language = 'auto' } = {}) => {
    if (active) throw new Error('A meeting is already being recorded.')

    const startedAt = new Date()
    const dir = await createSessionDir({ dataDir, title, at: startedAt })

    const capture = await startCapture({
      dir,
      onLevel: (event) => phase('recording', { seconds: event.seconds, levels: event.levels }),
      onWarning: (event) => phase('warning', { track: event.track, message: event.message }),
    })

    /*
     * Marked active before the microphone starts, not after: the permission handler only
     * grants the microphone while a meeting is recording, so asking first would deny our
     * own request.
     */
    active = { capture, dir, startedAt, title, language, micWarning: null }

    /*
     * Started after the system track, and never allowed to fail the meeting: the other
     * participants are the part that cannot be recovered afterwards.
     */
    if (withMic && mic) {
      const started = await mic.start({ dir })
      if (!started.ok) {
        active = { ...active, micWarning: `The microphone was not recorded: ${started.error}.` }
      }
    }
    phase('recording', { seconds: 0, levels: {} })
    return { dir, startedAt: startedAt.toISOString() }
  }

  const stop = async ({ allowCloud = false } = {}) => {
    if (!active) throw new Error('No meeting is being recorded.')
    const { capture, dir, startedAt, title, language, micWarning } = active
    active = null

    const [summary, micTrack] = await Promise.all([capture.stop(), mic?.stop() ?? null])

    return processRecording({
      dataDir,
      dir,
      capturedTracks: [...(summary?.tracks ?? []), ...(micTrack ? [micTrack] : [])],
      extraWarnings: micWarning ? [micWarning] : [],
      startedAt,
      endedAt: new Date(),
      title,
      language,
      allowCloud,
      phase,
    })
  }

  const cancel = async () => {
    if (!active) return
    const { capture } = active
    active = null
    await Promise.all([capture.stop(), mic?.stop() ?? null])
    phase('idle')
  }

  return {
    start,
    stop,
    cancel,
    isRecording: () => Boolean(active),
    maxSeconds: MEETING.maxHours * 3600,
  }
}
