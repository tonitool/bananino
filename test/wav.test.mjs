import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWavWriter, toPcm16, wavHeader } from '../src/main/meeting/wav.js'

test('the header declares the sizes a WAV reader expects', () => {
  const header = wavHeader({ sampleRate: 16000, channels: 1, dataBytes: 320 })
  assert.equal(header.length, 44)
  assert.equal(header.toString('ascii', 0, 4), 'RIFF')
  assert.equal(header.readUInt32LE(4), 356, 'RIFF size is data + 36')
  assert.equal(header.toString('ascii', 8, 12), 'WAVE')
  assert.equal(header.readUInt16LE(20), 1, 'PCM format')
  assert.equal(header.readUInt32LE(24), 16000)
  assert.equal(header.readUInt32LE(28), 32000, 'byte rate is 16 kHz x 2 bytes')
  assert.equal(header.readUInt32LE(40), 320, 'data size')
})

test('samples are clamped rather than wrapped around', () => {
  const pcm = toPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))
  assert.equal(pcm.readInt16LE(0), 0)
  assert.equal(pcm.readInt16LE(2), 32767)
  assert.equal(pcm.readInt16LE(4), -32767)
  assert.equal(pcm.readInt16LE(6), 32767, 'above full scale must not overflow to negative')
  assert.equal(pcm.readInt16LE(8), -32767)
  assert.equal(pcm.readInt16LE(10), 16384)
})

test('a streamed file ends up with a header matching what was written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lualala-wav-'))
  try {
    const path = join(dir, 'out.wav')
    const writer = await createWavWriter({ path, sampleRate: 16000 })

    // Three separate appends, as the recorder delivers them.
    for (let chunk = 0; chunk < 3; chunk += 1) {
      await writer.append(new Float32Array(1600).fill(0.25))
    }
    const result = await writer.close()

    const file = await readFile(path)
    assert.equal(file.length, 44 + 3 * 1600 * 2)
    assert.equal(file.readUInt32LE(40), 3 * 1600 * 2, 'data size patched on close')
    assert.equal(file.readUInt32LE(4), file.length - 8)
    assert.equal(result.seconds, 0.3)
    assert.equal(file.readInt16LE(44), 8192, 'first sample survived the round trip')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('appending nothing is a no-op rather than a corrupt file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lualala-wav-'))
  try {
    const path = join(dir, 'empty.wav')
    const writer = await createWavWriter({ path, sampleRate: 16000 })
    await writer.append(new Float32Array(0))
    await writer.append(undefined)
    const result = await writer.close()

    assert.equal(result.dataBytes, 0)
    assert.equal((await readFile(path)).length, 44)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('concurrent appends do not overwrite each other', async () => {
  // Regression: appends used to read `dataBytes` before awaiting their write, so two
  // in-flight chunks resolved to the same file offset and one was lost.
  const dir = await mkdtemp(join(tmpdir(), 'lualala-wav-'))
  try {
    const path = join(dir, 'race.wav')
    const writer = await createWavWriter({ path, sampleRate: 16000 })

    const chunks = Array.from({ length: 20 }, (_, i) =>
      new Float32Array(800).fill((i + 1) / 100),
    )
    // Fired without awaiting, exactly as the IPC handler does.
    await Promise.all(chunks.map((chunk) => writer.append(chunk)))
    const result = await writer.close()

    assert.equal(result.dataBytes, 20 * 800 * 2, 'every chunk landed')
    const file = await readFile(path)
    assert.equal(file.length, 44 + 20 * 800 * 2)

    // Order is preserved, so sample values still ascend chunk by chunk.
    for (let i = 0; i < 20; i += 1) {
      const expected = Math.round(((i + 1) / 100) * 0x7fff)
      assert.equal(file.readInt16LE(44 + i * 800 * 2), expected, `chunk ${i}`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('level is tracked so silent and quiet tracks can be recognised', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lualala-wav-'))
  try {
    const silence = await createWavWriter({ path: join(dir, 'silent.wav'), sampleRate: 16000 })
    await silence.append(new Float32Array(1600).fill(0))
    const silent = await silence.close()
    assert.equal(silent.peak, 0, 'digital silence peaks at zero')
    assert.equal(silent.rms, 0)

    // A single loud transient in an otherwise quiet track: peak alone would call this
    // healthy, which is how a hallucinated transcript got into a note.
    const spiky = await createWavWriter({ path: join(dir, 'spiky.wav'), sampleRate: 16000 })
    const samples = new Float32Array(16000)
    samples[0] = 0.9
    await spiky.append(samples)
    const spikyResult = await spiky.close()
    assert.ok(Math.abs(spikyResult.peak - 0.9) < 1e-6, 'peak sees the transient')
    assert.ok(spikyResult.rms < 0.008, `rms sees the silence (got ${spikyResult.rms})`)

    const loud = await createWavWriter({ path: join(dir, 'loud.wav'), sampleRate: 16000 })
    await loud.append(new Float32Array([0.01, -0.42, 0.08]))
    // Float32 storage rounds 0.42, so compare with a tolerance rather than exactly.
    const { peak } = await loud.close()
    assert.ok(Math.abs(peak - 0.42) < 1e-6, `peak uses magnitude, not sign (got ${peak})`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
