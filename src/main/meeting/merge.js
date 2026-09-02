/*
 * The two tracks are transcribed separately, then interleaved by timestamp.
 *
 * Keeping them separate through transcription is what lets the note say who spoke: one
 * mixed file would be a single anonymous wall of text, and one side failing would be
 * indistinguishable from a quiet meeting.
 */
export const SPEAKERS = Object.freeze({ system: 'Participants', mic: 'You' })

export const speakerFor = (track) => SPEAKERS[track] ?? track

/** Segments from every track, in the order they were actually spoken. */
export const mergeTracks = (tracks) =>
  tracks
    .flatMap(({ name, segments }) =>
      segments.map((segment) => ({ ...segment, speaker: speakerFor(name) })),
    )
    .sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs)

/*
 * Only tracks that produced speech count. A track whose transcript was discarded still
 * carries whatever language whisper guessed from the noise, and listing that in the note
 * claims a language nobody spoke.
 */
export const languagesIn = (tracks) => [
  ...new Set(
    tracks
      .filter((track) => (track.segments?.length ?? 0) > 0)
      .map((track) => track.language)
      .filter((code) => code && code !== 'auto'),
  ),
]
