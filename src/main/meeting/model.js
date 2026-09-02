import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { WHISPER } from '../constants.js'

export const modelPath = (dataDir) => join(dataDir, 'models', WHISPER.model)

/** Present and the right size — a truncated model yields garbage rather than an error. */
export const isModelReady = async (dataDir) => {
  const info = await stat(modelPath(dataDir)).catch(() => null)
  return Boolean(info && info.size === WHISPER.modelBytes)
}

/**
 * Fetches the transcription model on first use.
 *
 * It is not shipped in the DMG: at 465 MB it would triple the download for everyone,
 * including people who never record a meeting. Written to a temporary name and renamed
 * only once complete, so an interrupted download can never look like a usable model.
 */
export const downloadModel = async ({ dataDir, onProgress, signal }) => {
  if (await isModelReady(dataDir)) return modelPath(dataDir)

  const target = modelPath(dataDir)
  const partial = `${target}.partial`
  await mkdir(join(dataDir, 'models'), { recursive: true })
  await rm(partial, { force: true })

  const response = await fetch(WHISPER.modelUrl, { signal })
  if (!response.ok || !response.body) {
    throw new Error(`could not download the transcription model (HTTP ${response.status})`)
  }

  const total = Number(response.headers.get('content-length')) || WHISPER.modelBytes
  let received = 0
  const counter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength
      onProgress?.({ received, total, ratio: total ? received / total : 0 })
      controller.enqueue(chunk)
    },
  })

  await pipeline(response.body.pipeThrough(counter), createWriteStream(partial))

  const info = await stat(partial)
  if (info.size !== WHISPER.modelBytes) {
    await rm(partial, { force: true })
    throw new Error(
      `the downloaded model is ${info.size} bytes, expected ${WHISPER.modelBytes} — download was incomplete`,
    )
  }

  await rename(partial, target)
  return target
}
