/*
 * Compiles the Swift capture helper into resources/bin, where electron-builder picks it
 * up as an extra resource. It cannot live in the asar archive: macOS cannot exec a file
 * inside one.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE_DIR = 'native/audioTap'
const OUT_DIR = 'resources/bin'
const BINARY = 'lualala-audio-tap'

mkdirSync(OUT_DIR, { recursive: true })

const sources = readdirSync(SOURCE_DIR)
  .filter((name) => name.endsWith('.swift'))
  .map((name) => join(SOURCE_DIR, name))

if (sources.length === 0) throw new Error(`no Swift sources in ${SOURCE_DIR}`)

execFileSync(
  'swiftc',
  [
    '-O',
    '-o', join(OUT_DIR, BINARY),
    ...sources,
    '-framework', 'CoreAudio',
    '-framework', 'AudioToolbox',
    '-framework', 'AVFoundation',
  ],
  { stdio: 'inherit' },
)

console.log(`build-native: ${BINARY} built from ${sources.length} sources`)
