import { MEETING } from '../constants.js'

/*
 * A silent track is dropped rather than transcribed: recognisers invent plausible
 * sentences out of silence, and invented content in a meeting record is worse than an
 * acknowledged gap.
 */
const MESSAGES = Object.freeze({
  system:
    "The other participants' audio was silent. Check that the meeting was actually " +
    'playing through this Mac, and that Bananino has System Audio Recording permission ' +
    'in System Settings › Privacy & Security.',
  mic:
    'Your microphone was silent — check the input device, and that nothing else has ' +
    'taken exclusive hold of it.',
})

export const classifyTracks = (summaryTracks = []) => {
  const audible = []
  const warnings = []

  for (const track of summaryTracks) {
    if (track.seconds < MEETING.minSeconds) {
      warnings.push(`The ${track.name} track was too short to transcribe.`)
      continue
    }
    if (track.level < MEETING.silenceRms) {
      warnings.push(MESSAGES[track.name] ?? `The ${track.name} track was silent.`)
      continue
    }
    if (track.droppedSamples > 0) {
      warnings.push(
        `${track.droppedSamples} samples were dropped from the ${track.name} track — ` +
          'the transcript may have small gaps.',
      )
    }
    audible.push(track)
  }

  return { audible, warnings }
}
