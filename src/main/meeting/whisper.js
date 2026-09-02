import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { WHISPER } from '../constants.js'
import { whisperBinary } from './binaries.js'

export { dropNonSpeech, isNonSpeech } from './speech.js'

const run = promisify(execFile)

/**
 * Transcribes one WAV with whisper.cpp and returns its segments.
 *
 * `language` is the *source* language, never a translation target: whisper's --translate
 * degrades the content a meeting note depends on, so translating is left to the language
 * model and whisper only ever writes down what was actually said.
 */
export const transcribe = async ({ wavPath, modelPath, language = 'auto', signal }) => {
  const binary = await whisperBinary()
  const outputBase = wavPath.replace(/\.wav$/i, '')

  await run(
    binary,
    [
      '-m', modelPath,
      '-f', wavPath,
      '-l', language,
      '-t', String(WHISPER.threads),
      '--output-json',
      '--output-file', outputBase,
      '--no-prints',
    ],
    { signal, maxBuffer: 32 * 1024 * 1024 },
  )

  const raw = JSON.parse(await readFile(`${outputBase}.json`, 'utf8'))
  return {
    language: raw.result?.language ?? language,
    segments: (raw.transcription ?? [])
      .map((segment) => ({
        fromMs: segment.offsets?.from ?? 0,
        toMs: segment.offsets?.to ?? 0,
        text: String(segment.text ?? '').trim(),
      }))
      .filter((segment) => segment.text.length > 0),
  }
}
