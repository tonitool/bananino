import { join } from 'node:path'
import { createWavWriter } from './wav.js'

export const MIC_FILE = 'mic.wav'
const START_TIMEOUT_MS = 8000

/**
 * Owns the microphone track, which is recorded in the renderer and written here.
 *
 * The renderer holds the microphone because permission is granted per binary and only
 * the app itself can ask for it; the file is written here because the renderer is
 * sandboxed and has no filesystem. Chunks therefore cross the bridge as raw samples.
 */
export const createMicBridge = ({ send }) => {
  let track = null

  const start = async ({ dir }) => {
    if (track) throw new Error('The microphone is already recording.')

    const writer = await createWavWriter({ path: join(dir, MIC_FILE), sampleRate: 16_000 })
    let settle
    const ready = new Promise((resolve) => {
      settle = resolve
    })
    track = { writer, settle, started: false, error: null }

    send({ type: 'mic-start' })

    /*
     * A microphone that never starts must not hold up the meeting: the system track is
     * already recording by now, and waiting forever would lose it too.
     */
    const outcome = await Promise.race([
      ready,
      new Promise((resolve) =>
        setTimeout(() => resolve({ event: 'error', message: 'the microphone did not start' }), START_TIMEOUT_MS),
      ),
    ])

    if (outcome.event === 'error') {
      const message = outcome.message
      await writer.close()
      track = null
      return { ok: false, error: message }
    }
    return { ok: true }
  }

  /** Called from the IPC layer as samples arrive. */
  const handleChunk = (samples) => {
    if (!track || !samples?.length) return
    void track.writer.append(samples)
  }

  const handleState = (state) => {
    if (!track) return
    if (state?.event === 'started') {
      track.started = true
      track.settle({ event: 'started' })
    }
    if (state?.event === 'error') {
      track.error = state.message
      track.settle({ event: 'error', message: state.message })
    }
  }

  const stop = async () => {
    if (!track) return null
    const { writer } = track
    send({ type: 'mic-stop' })
    // A moment for the last in-flight chunks, which are already on their way over.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const summary = await writer.close()
    track = null
    return {
      name: 'mic',
      seconds: summary.seconds,
      level: summary.rms,
      droppedSamples: 0,
    }
  }

  return { start, stop, handleChunk, handleState, isRecording: () => Boolean(track) }
}
