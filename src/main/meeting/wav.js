import { open } from 'node:fs/promises'

const HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8

/**
 * A 44-byte canonical WAV header. Sizes are patched in on close, which is why the file is
 * opened for random access rather than appended to blindly.
 */
export const wavHeader = ({ sampleRate, channels, dataBytes }) => {
  const header = Buffer.alloc(HEADER_BYTES)
  const byteRate = sampleRate * channels * BYTES_PER_SAMPLE

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * BYTES_PER_SAMPLE, 32) // block align
  header.writeUInt16LE(BITS_PER_SAMPLE, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)

  return header
}

/** Float samples in -1..1 to little-endian signed 16-bit, clamped rather than wrapped. */
export const toPcm16 = (samples) => {
  const buffer = Buffer.alloc(samples.length * BYTES_PER_SAMPLE)
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(clamped * 0x7fff), i * BYTES_PER_SAMPLE)
  }
  return buffer
}

/**
 * Streams PCM to disk as it arrives instead of buffering a whole meeting in memory —
 * an hour of 16 kHz mono is ~115 MB per track.
 */
export const createWavWriter = async ({ path, sampleRate, channels = 1 }) => {
  const handle = await open(path, 'w')
  let dataBytes = 0
  let peak = 0
  let sumOfSquares = 0
  let sampleCount = 0

  // Chunks arrive from the recorder faster than a write completes, so every write is
  // chained onto the last. Without this, two appends read the same offset and one
  // silently overwrites the other.
  let tail = handle.write(wavHeader({ sampleRate, channels, dataBytes: 0 }), 0, HEADER_BYTES, 0)

  const enqueue = (work) => {
    tail = tail.then(work, work)
    return tail
  }

  const append = (samples) => {
    if (!samples?.length) return tail
    // Measured here because this is the one place every sample passes through. RMS is
    // what matters, not peak: a single transient can be loud while the track as a whole
    // is far too quiet to recognise.
    for (const sample of samples) {
      const magnitude = Math.abs(sample)
      if (magnitude > peak) peak = magnitude
      sumOfSquares += sample * sample
    }
    sampleCount += samples.length

    return enqueue(async () => {
      const pcm = toPcm16(samples)
      await handle.write(pcm, 0, pcm.length, HEADER_BYTES + dataBytes)
      dataBytes += pcm.length
    })
  }

  const close = () =>
    enqueue(async () => {
      // Rewrite the header now that the true length is known.
      await handle.write(wavHeader({ sampleRate, channels, dataBytes }), 0, HEADER_BYTES, 0)
      await handle.close()
      return {
        path,
        dataBytes,
        peak,
        rms: sampleCount > 0 ? Math.sqrt(sumOfSquares / sampleCount) : 0,
        seconds: dataBytes / (sampleRate * channels * BYTES_PER_SAMPLE),
      }
    })

  return { append, close, bytesWritten: () => dataBytes, peak: () => peak }
}

export const toDecibels = (amplitude) =>
  amplitude > 0 ? Math.round(20 * Math.log10(amplitude)) : -Infinity
