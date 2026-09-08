import assert from 'node:assert/strict'
import test from 'node:test'
import { isCloudModel, pickModel, streamChat, visibleSoFar } from '../src/main/meeting/llm.js'
import { HISTORY_TURNS, SYSTEM, buildMessages, describeDay } from '../src/main/chat/prompt.js'
import { createTools, kindOf } from '../src/main/chat/tools.js'

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
    assert.equal(answer.text, 'You tracked 3h 40m today.')
    // And it arrived in pieces, which is the entire reason this function exists.
    assert.ok(seen.length > 1, `expected several updates, got ${seen.length}`)
  } finally {
    globalThis.fetch = original
  }
})

test('a turn can both speak and call a tool', async () => {
  // Models routinely say "let me check" and call something in the same message, so a turn
  // that treated the two as alternatives would drop one of them.
  const lines = [
    JSON.stringify({ message: { content: 'Let me look.' } }),
    JSON.stringify({
      message: { tool_calls: [{ function: { name: 'read_notes', arguments: { date: '2026-01-13' } } }] },
    }),
    JSON.stringify({ done: true }),
  ].join('\n')

  const original = globalThis.fetch
  let sent = null
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body)
    return { ok: true, body: (async function* () { yield new TextEncoder().encode(lines) })() }
  }
  try {
    const answer = await streamChat({
      model: 'llama3.2',
      messages: [],
      tools: [{ type: 'function', function: { name: 'read_notes' } }],
    })
    assert.equal(answer.text, 'Let me look.')
    assert.deepEqual(answer.calls, [{ name: 'read_notes', arguments: { date: '2026-01-13' } }])
    assert.equal(sent.tools.length, 1, 'the tools were not offered to the model')
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

test('an act that cannot be undone does not happen without a press', async () => {
  // The rule the whole acting design rests on. It is tested by asking every tool which
  // side of it they are on, rather than by trusting the list to stay right by hand.
  const ran = []
  const actions = {
    startTimer: async (task) => ran.push(['startTimer', task]),
    stopTimer: async () => ran.push(['stopTimer']),
    saveNote: async (text) => ran.push(['saveNote', text]),
    addManualTime: async (payload) => ran.push(['addManualTime', payload.task]),
    mocoPush: async () => ran.push(['mocoPush']),
    deleteNote: async (index) => ran.push(['deleteNote', index]),
    cancelTimer: () => ran.push(['cancelTimer']),
  }

  const snapshot = {
    timer: { task: 'BIK', startedAt: Date.now() - 60 * 60_000 },
    moco: { connected: true, pending: 2, failed: 0 },
  }
  const tools = createTools({
    actions,
    getSnapshot: () => snapshot,
    readNotes: async () => [{ index: 3, time: '11:04', text: 'a note' }],
    searchTasks: () => [],
  })

  // Reversible acts offer an undo; the rest offer nothing and so must be proposed.
  assert.deepEqual(
    Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, kindOf(tool)])),
    {
      start_timer: 'undoable',
      save_note: 'undoable',
      stop_timer: 'needs-a-press',
      add_past_time: 'needs-a-press',
      push_moco: 'needs-a-press',
      read_notes: 'read',
      read_clips: 'read',
      find_moco_task: 'read',
    },
  )

  // And an irreversible one describes the press without taking it.
  const proposal = await tools.stop_timer.propose({})
  assert.match(proposal.title, /Stop “BIK”/)
  assert.match(proposal.detail, /queues it for MOCO/)
  assert.deepEqual(ran, [], 'proposing an act was enough to perform it')

  // Only the press runs it.
  await tools.stop_timer.run({})
  assert.deepEqual(ran, [['stopTimer']])
})

test('a chat-started timer books to MOCO when the task names one catalogue entry', async () => {
  // The regression this guards: start_timer used to call the action with a null binding
  // always, so every chat-tracked stint was logged locally and could never be pushed.
  const started = []
  const entry = {
    projectId: 42,
    taskId: 7,
    customer: 'Clue One',
    project: 'Creative Engine JuniorDepot',
    task: 'Creative Technologist',
    label: 'Creative Engine JuniorDepot — Creative Technologist',
  }
  const tools = createTools({
    actions: { startTimer: async (...args) => started.push(args) },
    getSnapshot: () => ({}),
    readNotes: async () => [],
    searchTasks: () => [entry],
  })

  const outcome = await tools.start_timer.run({ task: 'Creative Engine JuniorDepot — Creative Technologist' })

  assert.deepEqual(started[0][1], { projectId: 42, taskId: 7, label: entry.label })
  assert.match(outcome.told, /queues for MOCO/)
})

test('a moco_query binds only on a single answer — two matches means no guess', async () => {
  const started = []
  const junior = { projectId: 1, taskId: 2, label: 'Creative Engine JuniorDepot — Creative Technologist' }
  const senior = { projectId: 1, taskId: 3, label: 'Creative Engine SeniorDepot — Creative Technologist' }
  const tools = createTools({
    actions: { startTimer: async (...args) => started.push(args) },
    getSnapshot: () => ({}),
    readNotes: async () => [],
    searchTasks: () => [junior, senior],
  })

  const outcome = await tools.start_timer.run({ task: 'Creative Engine', moco_query: 'creative engine' })

  assert.equal(started[0][1], null, 'an ambiguous query must not pick a billable target')
  assert.match(outcome.told, /stays local/)
})

test('read_clips answers from the clipboard history, shortened to a line each', async () => {
  // readClips is handed in query-filtered, exactly as app.js's searchClips wrapper works.
  const clips = [
    { text: '/Users/me/Desktop/spec sketch\nfinal v3.pdf', at: 1, pinned: false },
    { text: 'a shopping list', at: 2, pinned: false },
  ]
  const tools = createTools({
    actions: {},
    getSnapshot: () => ({}),
    readNotes: async () => [],
    searchTasks: () => [],
    readClips: async ({ query } = {}) =>
      clips.filter((clip) => !query || clip.text.toLowerCase().includes(query)),
  })

  const answer = await tools.read_clips.read({ query: 'spec' })
  assert.equal(answer, '/Users/me/Desktop/spec sketch final v3.pdf')

  const none = await tools.read_clips.read({ query: 'zzzz' })
  assert.match(none, /nothing in the clipboard history/i)
})

test('a second timer is refused rather than silently logging the first', async () => {
  // start_timer is undoable only because it has written nothing. Letting it stop a running
  // timer would log that stint, and the Undo pill could not put the entry back.
  const ran = []
  const tools = createTools({
    actions: { startTimer: async (task) => ran.push(task) },
    getSnapshot: () => ({ timer: { task: 'BIK', startedAt: Date.now() } }),
    readNotes: async () => [],
    searchTasks: () => [],
  })

  const outcome = await tools.start_timer.run({ task: 'Admin' })
  assert.match(outcome.failed, /already running on "BIK"/)
  assert.deepEqual(ran, [])
})

test('an Ollama cloud model is never picked by accident', () => {
  // Ollama's paid plan lists cloud models in the local daemon and serves them over the
  // same localhost port. They are also far bigger than anything a laptop runs, so the
  // "biggest thing that fits" heuristic would reach for one the moment somebody
  // subscribed — and every part of this app that talks to Ollama does so on the promise
  // that the words stay on the machine.
  const installed = [
    { name: 'gpt-oss:120b-cloud', size: 0 },
    { name: 'glm-4.6:cloud', size: 0 },
    { name: 'llama3.2:latest', size: 2_000_000_000 },
  ]

  assert.equal(pickModel(installed), 'llama3.2:latest')
  assert.ok(isCloudModel('gpt-oss:120b-cloud'))
  assert.ok(isCloudModel('glm-4.6:cloud'))
  assert.ok(!isCloudModel('llama3.2:latest'))

  // With nothing local installed it reports having nothing rather than quietly going out.
  assert.equal(pickModel(installed.slice(0, 2)), null)

  // Chosen by name, it is used — that is the only way a cloud model is ever reached.
  assert.equal(
    pickModel(installed, undefined, { prefer: 'gpt-oss:120b-cloud', allowCloud: true }),
    'gpt-oss:120b-cloud',
  )
})
