import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { audioTapBinary } from './binaries.js'

export const TRACKS = Object.freeze({ system: 'system.wav', mic: 'mic.wav' })

/**
 * Runs the native capture helper for the length of a meeting.
 *
 * The helper writes both WAVs itself and reports levels as JSON lines, so nothing has to
 * be streamed through this process. `stop` resolves with the helper's own summary — the
 * per-track duration and level that decide what is worth transcribing.
 */
export const startCapture = async ({ dir, withMic = true, onLevel, onWarning }) => {
  const binary = await audioTapBinary()
  const args = ['--system', join(dir, TRACKS.system)]
  if (withMic) args.push('--mic', join(dir, TRACKS.mic))

  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  let summary = null
  let startupError = null
  const stderr = []
  let pending = ''

  const started = new Promise((resolve, reject) => {
    const settle = (event) => {
      if (event.event === 'started') resolve(event)
      if (event.event === 'error') {
        startupError = new Error(event.message ?? 'capture failed to start')
        reject(startupError)
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        settle(event)
        if (event.event === 'level') onLevel?.(event)
        if (event.event === 'warning') onWarning?.(event)
        if (event.event === 'stopped') summary = event
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => stderr.push(chunk))

    child.on('error', reject)
    child.on('exit', (code) => {
      if (summary || startupError) return
      reject(new Error(`capture helper exited with code ${code}. ${stderr.join('')}`.trim()))
    })
  })

  await started

  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve(summary)
      child.on('exit', () => resolve(summary))
      // The helper finalises both WAV headers on SIGTERM; killing it harder would leave
      // the recording unplayable.
      child.kill('SIGTERM')
    })

  return { stop, pid: child.pid }
}
