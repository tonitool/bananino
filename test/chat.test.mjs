import assert from 'node:assert/strict'
import test from 'node:test'
import { streamChat, visibleSoFar } from '../src/main/meeting/llm.js'
import { HISTORY_TURNS, SYSTEM, buildMessages, describeDay } from '../src/main/chat/prompt.js'

test('a reasoning scratchpad is hidden while it is still being written', () => {
  // The closed case is what stripThinking already handled; the open one is the streaming
  // bug — mid-answer the tag has no partner yet, and the scratchpad would stream into the
  // panel as if it were the reply.
  assert.equal(visibleSoFar('Sure. <think>the user probably means'), 'Sure.')
  assert.equal(visibleSoFar('<think>hmm</think>Two hours.'), 'Two hours.')
  assert.equal(visibleSoFar('Two hours.'), 'Two hours.')
})

test('a streamed answer survives a chunk that splits a line in half', async () => {
  const lines = [
    JSON.stringify({ message: { content: 'You tracked ' } }),
    JSON.stringify({ message: { content: '3h 40m' } }),
    JSON.stringify({ message: { content: ' today.' } }),
    JSON.stringify({ done: true }),
  ].join('\n')

  // Ollama sends newline-delimited JSON and a network chunk is not a line: cut the body at
  // an arbitrary byte to prove the parser holds the tail back instead of parsing hopefully.
  const bytes = new TextEncoder().encode(lines)
  const body = {
    async *[Symbol.asyncIterator]() {
      yield bytes.slice(0, 37)
      yield bytes.slice(37)
    },
  }

  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, body })
  try {
    const seen = []
    const answer = await streamChat({
      model: 'llama3.2',
      messages: [],
      onText: (text) => seen.push(text),
    })
    assert.equal(answer, 'You tracked 3h 40m today.')
    // And it arrived in pieces, which is the entire reason this function exists.
    assert.ok(seen.length > 1, `expected several updates, got ${seen.length}`)
  } finally {
    globalThis.fetch = original
  }
})

test('the day describes a running timer and stays quiet about what it cannot see', () => {
  const day = describeDay(
    {
      timer: { task: 'BIK · Konzeption', startedAt: Date.now() - 90 * 60_000, description: '' },
      today: { minutes: 220, entries: 3, notes: 2 },
      recentTasks: ['BIK · Konzeption'],
      recentNotes: [],
      clips: [],
      moco: { connected: false },
      calendar: null,
    },
    new Date(2026, 0, 14, 11, 5),
  )

  assert.match(day, /timer is running right now on "BIK · Konzeption", started 90 minutes ago/)
  assert.match(day, /Tracked today: 3h 40m across 3 entries/)
  // An absent fact is absent, not reported as empty: a wall of "none" teaches a small
  // model to talk about empty fields instead of about the day.
  assert.doesNotMatch(day, /Notes written today:\n/)
  assert.doesNotMatch(day, /Clipboard/)
  assert.doesNotMatch(day, /MOCO/)
})

test('every turn carries the brief, a fresh day, and a bounded slice of history', () => {
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `turn ${index}`,
  }))

  const messages = buildMessages({
    history,
    snapshot: { today: { minutes: 0, entries: 0, notes: 0 }, timer: null },
    now: new Date(2026, 0, 14, 9, 0),
  })

  assert.equal(messages[0].content, SYSTEM)
  // The day is its own message so it can be rebuilt every turn: a timer stopped mid
  // conversation must not still be running in what the model reads.
  assert.match(messages[1].content, /^TODAY\n/)
  assert.equal(messages.length, 2 + HISTORY_TURNS * 2)
  assert.equal(messages.at(-1).content, 'turn 39')
})
