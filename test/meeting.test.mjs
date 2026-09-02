import assert from 'node:assert/strict'
import test from 'node:test'
import { languagesIn, mergeTracks, speakerFor } from '../src/main/meeting/merge.js'
import { classifyTracks } from '../src/main/meeting/silence.js'
import { dropNonSpeech, isDegenerate, isNonSpeech } from '../src/main/meeting/speech.js'
import { sessionFolderName, slugify } from '../src/main/meeting/paths.js'
import { composeNote } from '../src/main/meeting/note.js'

test('tracks are interleaved by the time things were actually said', () => {
  const merged = mergeTracks([
    { name: 'mic', segments: [{ fromMs: 1000, toMs: 2000, text: 'mine' }] },
    {
      name: 'system',
      segments: [
        { fromMs: 0, toMs: 900, text: 'theirs first' },
        { fromMs: 2100, toMs: 3000, text: 'theirs last' },
      ],
    },
  ])
  assert.deepEqual(
    merged.map((segment) => [segment.speaker, segment.text]),
    [
      ['Participants', 'theirs first'],
      ['You', 'mine'],
      ['Participants', 'theirs last'],
    ],
  )
})

test('speakers are named for a reader, not by track id', () => {
  assert.equal(speakerFor('mic'), 'You')
  assert.equal(speakerFor('system'), 'Participants')
})

test('detected languages are collected, ignoring undetected ones', () => {
  const languages = languagesIn([
    { language: 'de', segments: [{ text: 'ja' }] },
    { language: 'auto', segments: [{ text: 'x' }] },
    { language: 'de', segments: [{ text: 'nochmal' }] },
    { language: 'en', segments: [{ text: 'yes' }] },
    { language: null, segments: [{ text: 'x' }] },
  ])
  assert.deepEqual(languages, ['de', 'en'])
})

test('a language guessed from a discarded track is not claimed in the note', () => {
  // The real case: a quiet microphone was transcribed as repeated glyphs and detected
  // as Norwegian, which then appeared in the note as a language of the meeting.
  const languages = languagesIn([
    { language: 'en', segments: [{ text: 'Budget approved.' }] },
    { language: 'nn', segments: [] },
  ])
  assert.deepEqual(languages, ['en'])
})

test('hallucinated glyph runs from a quiet track are not treated as speech', () => {
  assert.ok(isDegenerate('ᶠᶠᶠᶠᶠᶠᶠᶠᶠ'))
  assert.ok(isDegenerate('....'))
  assert.ok(isDegenerate('ah ah ah ah'.replace(/[^a]/g, '')))
  // Real speech survives, including short words and other alphabets.
  assert.ok(!isDegenerate('Budget approved.'))
  assert.ok(!isDegenerate('Ja'))
  assert.ok(!isDegenerate('Guten Morgen'))
  assert.ok(!isDegenerate('三人で会議しました'))
})

test('dropNonSpeech removes hallucinations as well as annotations', () => {
  const kept = dropNonSpeech([
    { text: '(music)' },
    { text: 'ᶠᶠᶠᶠᶠᶠᶠᶠᶠ' },
    { text: 'We ship on Friday.' },
  ])
  assert.deepEqual(
    kept.map((segment) => segment.text),
    ['We ship on Friday.'],
  )
})

test('a silent track is dropped with an actionable reason, never transcribed', () => {
  const { audible, warnings } = classifyTracks([
    { name: 'system', seconds: 600, level: 0.00001, droppedSamples: 0 },
    { name: 'mic', seconds: 600, level: 0.02, droppedSamples: 0 },
  ])
  assert.deepEqual(
    audible.map((track) => track.name),
    ['mic'],
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /System Audio Recording permission/)
})

test('a track too short to be a meeting is dropped', () => {
  const { audible, warnings } = classifyTracks([
    { name: 'system', seconds: 2, level: 0.5, droppedSamples: 0 },
  ])
  assert.equal(audible.length, 0)
  assert.match(warnings[0], /too short/)
})

test('dropped samples are reported but the track is still transcribed', () => {
  const { audible, warnings } = classifyTracks([
    { name: 'system', seconds: 600, level: 0.02, droppedSamples: 4096 },
  ])
  assert.equal(audible.length, 1)
  assert.match(warnings[0], /4096 samples were dropped/)
})

test("whisper's non-speech annotations never reach the transcript as speech", () => {
  assert.ok(isNonSpeech('(upbeat music)'))
  assert.ok(isNonSpeech('[BLANK_AUDIO]'))
  assert.ok(isNonSpeech('♪'))
  assert.ok(isNonSpeech('  '))
  assert.ok(!isNonSpeech('We decided to ship on Friday.'))
})

test('dropNonSpeech keeps only what somebody said', () => {
  const kept = dropNonSpeech([
    { text: '(music)' },
    { text: 'Budget is approved.' },
    { text: '[ Silence ]' },
  ])
  assert.deepEqual(
    kept.map((segment) => segment.text),
    ['Budget is approved.'],
  )
})

test('folder names stay safe on a case-insensitive filesystem', () => {
  assert.equal(slugify('Quartalsbudget — Q3/Q4 (final!)'), 'quartalsbudget-q3-q4-final')
  assert.equal(slugify('Über uns'), 'uber-uns')
  assert.equal(slugify('Grüße an Jörg'), 'gruesse-an-joerg'.replace('ue', 'u').replace('oe', 'o'))
  assert.equal(slugify('Straßenfest'), 'strassenfest')
  assert.equal(slugify('Budget – Q3 …'), 'budget-q3')
  assert.equal(slugify(''), '')
  assert.equal(slugify(null), '')
})

test('an untitled meeting still gets a unique, sortable folder', () => {
  const at = new Date(2026, 8, 2, 9, 5)
  assert.equal(sessionFolderName('', at), '2026-09-02-0905')
  assert.equal(sessionFolderName('Standup', at), '2026-09-02-0905-standup')
})

test('the note is written even when there is no summary', () => {
  const markdown = composeNote({
    title: 'Standup',
    startedAt: new Date(2026, 8, 2, 9, 0),
    endedAt: new Date(2026, 8, 2, 9, 15),
    languages: ['de'],
    segments: [{ fromMs: 0, toMs: 1000, text: 'Guten Morgen.', speaker: 'You' }],
    summary: null,
    warnings: ['The summary failed: Ollama is not reachable.'],
  })
  assert.match(markdown, /# Standup/)
  assert.match(markdown, /Guten Morgen\./)
  assert.match(markdown, /\[!warning\]/)
  assert.match(markdown, /Ollama is not reachable/)
})

test('a meeting with no speech says so instead of showing an empty transcript', () => {
  const markdown = composeNote({
    title: '',
    startedAt: new Date(2026, 8, 2, 9, 0),
    endedAt: new Date(2026, 8, 2, 9, 15),
    languages: [],
    segments: [],
    summary: null,
    warnings: [],
  })
  assert.match(markdown, /_No speech was detected\._/)
})

test('the summariser uses a model the user already has', async () => {
  const { pickModel } = await import('../src/main/meeting/llm.js')
  const GB = 1_000_000_000
  // Preferred family wins even when the tag differs.
  assert.equal(
    pickModel([
      { name: 'llama3.2:3b', size: 2 * GB },
      { name: 'qwen3.5:latest', size: 6.6 * GB },
    ]),
    'qwen3.5:latest',
  )
  // Falls back to whatever is installed rather than demanding a download.
  assert.equal(pickModel([{ name: 'some-custom:latest', size: GB }]), 'some-custom:latest')
  assert.equal(pickModel([]), null)
})

test('an oversized local model is skipped, because a timed-out summary is no summary', async () => {
  const { pickModel } = await import('../src/main/meeting/llm.js')
  const GB = 1_000_000_000
  assert.equal(
    pickModel([
      { name: 'qwen3.6:latest', size: 23 * GB },
      { name: 'llama3.2:3b', size: 2 * GB },
    ]),
    'llama3.2:3b',
  )
})

test('when every installed model is oversized, the smallest is used rather than none', async () => {
  const { pickModel } = await import('../src/main/meeting/llm.js')
  const GB = 1_000_000_000
  assert.equal(
    pickModel([
      { name: 'huge:latest', size: 70 * GB },
      { name: 'big:latest', size: 30 * GB },
    ]),
    'big:latest',
  )
})
