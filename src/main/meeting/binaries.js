import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/*
 * The capture helper and whisper-cli ship as extra resources rather than inside the asar
 * archive, because macOS cannot exec a file from inside one.
 */
const binDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'resources', 'bin')

const executable = async (path) => {
  await access(path, constants.X_OK)
  return path
}

export const audioTapBinary = () => executable(join(binDir(), 'bananino-audio-tap'))
export const whisperBinary = () => executable(join(binDir(), 'whisper-cli'))

/** Reported in the UI so a broken install is diagnosable rather than merely silent. */
export const checkBinaries = async () => {
  const results = await Promise.all(
    [
      ['capture', audioTapBinary],
      ['whisper', whisperBinary],
    ].map(async ([name, resolve]) => {
      try {
        return [name, { ok: true, path: await resolve() }]
      } catch (error) {
        return [name, { ok: false, error: error.message }]
      }
    }),
  )
  return Object.fromEntries(results)
}
