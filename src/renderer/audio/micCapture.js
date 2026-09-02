const WORKLET_URL = './pcmWorklet.js'
const PROCESSOR = 'pcm-collector'
const CHUNK_FRAMES = 4096

/**
 * Records the microphone for a meeting.
 *
 * Deliberately here rather than in the native capture helper: TCC attributes microphone
 * access per binary, and the helper carries its own ad-hoc signature, so inside the
 * packaged app macOS handed it a permanently empty input stream with no error. Going
 * through getUserMedia puts the request under the app's own identity, where the usage
 * description and the permission prompt actually apply.
 *
 * The context is opened at 16 kHz so Chromium does the resampling that whisper.cpp needs.
 */
export const createMicCapture = ({ onChunk, onState }) => {
  let stream = null
  let context = null
  let node = null

  const teardown = () => {
    node?.port.close()
    node?.disconnect()
    stream?.getTracks().forEach((track) => track.stop())
    const closing = context?.close()
    node = null
    stream = null
    context = null
    return closing ?? Promise.resolve()
  }

  const start = async () => {
    if (context) return
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Voice processing is off: it is tuned for calls, and here it would fight the
        // recogniser rather than help it.
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      })

      context = new AudioContext({ sampleRate: 16_000 })
      await context.audioWorklet.addModule(WORKLET_URL)

      node = new AudioWorkletNode(context, PROCESSOR, {
        processorOptions: { chunkFrames: CHUNK_FRAMES },
      })
      node.port.onmessage = (event) => onChunk(event.data)

      context.createMediaStreamSource(stream).connect(node)
      // A worklet only runs while something downstream pulls it, so it is connected
      // through a silent gain rather than left dangling.
      const silence = context.createGain()
      silence.gain.value = 0
      node.connect(silence).connect(context.destination)

      onState({ event: 'started', sampleRate: context.sampleRate })
    } catch (error) {
      await teardown()
      onState({ event: 'error', message: error?.message ?? String(error) })
    }
  }

  const stop = async () => {
    if (!context) return
    await teardown()
    onState({ event: 'stopped' })
  }

  return { start, stop, isRecording: () => Boolean(context) }
}
