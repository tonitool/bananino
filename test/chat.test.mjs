import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCloudModel, pickModel, streamChat, visibleSoFar } from '../src/main/meeting/llm.js'
import { HISTORY_TURNS, SYSTEM, buildMessages, describeDay } from '../src/main/chat/prompt.js'
import { createTools, kindOf } from '../src/main/chat/tools.js'
import { chooseEngine } from '../src/main/chat/engine.js'
import { streamChat as streamChatCloud } from '../src/main/chat/cloudStream.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** One track in the shape a player's reply is parsed into. */
const track = (title, artist, playerLabel = 'Spotify') => ({
  title,
  artist,
  playerLabel,
  player: playerLabel === 'Spotify' ? 'spotify' : 'music',
  position: 0,
  duration: 200,
})

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
      read_calendar: 'read',
      search_files: 'read',
      search_notes: 'read',
      search_messages: 'read',
      // Working the Mac: a skipped track is taken back by asking for the previous one,
      // while an opened file cannot be un-opened and so waits for a press.
      control_music: 'undoable',
      play_music: 'undoable',
      open_path: 'needs-a-press',
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

test('the engine decision is made from the mode and the key, never from the network', () => {
  // 'cloud' without a key is refused rather than quietly local: where a sentence goes is
  // the one thing this feature must never swap behind a user's back.
  assert.equal(chooseEngine({ mode: 'cloud', hasCloudKey: false }), 'needs-key')
  assert.equal(chooseEngine({ mode: 'cloud', hasCloudKey: true }), 'cloud')
  assert.equal(chooseEngine({ mode: 'local', hasCloudKey: true }), 'local')
  assert.equal(chooseEngine({ mode: 'auto', hasCloudKey: true }), 'cloud')
  assert.equal(chooseEngine({ mode: 'auto', hasCloudKey: false }), 'local')
})

test('a cloud answer survives a frame that splits a tool call in half', async () => {
  // OpenRouter sends tool arguments as JSON fragments across deltas. Assembling them per
  // stream index is the whole game: a half-read string parsed eagerly drops the call.
  const frames = [
    { choices: [{ delta: { content: 'Looking that' } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { name: 'search_files', arguments: '{"que' } },
            ],
          },
        },
      ],
    },
    { choices: [{ delta: { content: ' up…' } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: 'ry": "spec"}' } },
            ],
          },
        },
      ],
    },
  ]
  const sse =
    frames.map((frame) => `data: ${JSON.stringify(frame)}`).join('\n\n') + '\n\ndata: [DONE]\n\n'

  const bytes = new TextEncoder().encode(sse)
  const original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'anthropic/claude-sonnet-4.5')
    assert.equal(options.headers.Authorization, 'Bearer sk-test')
    assert.ok(Array.isArray(body.tools))
    return {
      ok: true,
      body: {
        async *[Symbol.asyncIterator]() {
          // Cut the stream mid-frame, mid-token: exactly where naive line parsing dies.
          yield bytes.slice(0, 60)
          yield bytes.slice(60)
        },
      },
    }
  }
  try {
    const seen = []
    const answer = await streamChatCloud({
      url: 'https://openrouter.invalid/v1/chat/completions',
      key: 'sk-test',
      model: 'anthropic/claude-sonnet-4.5',
      messages: [],
      tools: [{ type: 'function', function: { name: 'search_files' } }],
      onText: (text) => seen.push(text),
    })
    assert.equal(answer.text, 'Looking that up…')
    // The two fragments assemble into one whole call, and a valid one:
    assert.deepEqual(answer.calls, [{ name: 'search_files', arguments: '{"query": "spec"}' }])
    assert.deepEqual(JSON.parse(answer.calls[0].arguments), { query: 'spec' })
    assert.ok(seen.length > 1, `streamed in pieces, got ${seen.length} update(s)`)
  } finally {
    globalThis.fetch = original
  }
})

test('read_calendar answers from the snapshot the panel is already showing', async () => {
  const tools = createTools({
    actions: {},
    getSnapshot: () => ({
      calendar: {
        connected: true,
        upcoming: [
          { id: 'a', title: 'Weekly sync', startMs: Date.UTC(2026, 8, 9, 12, 30), endMs: 0, joinUrl: 'https://meet.google.com/x', location: '' },
        ],
      },
    }),
    readNotes: async () => [],
    searchTasks: () => [],
  })

  const answer = await tools.read_calendar.read({})
  assert.match(answer, /Weekly sync/)
  assert.match(answer, /14:30|12:30/) // the hour, whichever zone the test runner sits in
  assert.match(answer, /join link/)

  const unconnected = createTools({
    actions: {},
    getSnapshot: () => ({ calendar: { connected: false } }),
    readNotes: async () => [],
    searchTasks: () => [],
  })
  assert.match(await unconnected.read_calendar.read({}), /No calendar is connected/)
})

test('search_files hands paths back whole, dated, and scoped to the folder asked for', async () => {
  let asked = null
  const tools = createTools({
    actions: {},
    getSnapshot: () => ({}),
    readNotes: async () => [],
    searchTasks: () => [],
    searchFiles: async (request) => {
      asked = request
      return {
        dir: '/Users/me/Downloads',
        files: [
          {
            path: '/Users/me/Downloads/spec sketch final v3.pdf',
            modified: new Date('2026-09-12T14:03:00Z'),
          },
        ],
      }
    },
  })

  // A path you cannot open is a path not found, so it is never shortened — and the date
  // is how a person picks between "final" and "final v3".
  assert.equal(
    await tools.search_files.read({ query: 'spec sketch', folder: 'Downloads' }),
    '2026-09-12 14:03  /Users/me/Downloads/spec sketch final v3.pdf',
  )
  assert.deepEqual(asked, { query: 'spec sketch', folder: 'Downloads', limit: 10 })
})

test('a folder the buddy cannot place is reported in its own words', async () => {
  const tools = createTools({
    actions: {},
    getSnapshot: () => ({}),
    readNotes: async () => [],
    searchTasks: () => [],
    searchFiles: async () => ({ failed: 'I do not know where "wherever" is.' }),
  })

  assert.match(await tools.search_files.read({ query: 'x', folder: 'wherever' }), /do not know where/)
})

test('every reader app.js hands the chat reaches the tool that needs it', async () => {
  // The regression: createChat took searchFiles from app.js and never passed it on to
  // createTools, so search_files answered "not available here" for a whole release while
  // the wiring beside it looked correct. Checked as text because session.js cannot be
  // imported under plain node — it reaches electron through the LLM clients.
  const source = await readFile(join(ROOT, 'src', 'main', 'chat', 'session.js'), 'utf8')
  const forwarded = source.slice(source.indexOf('createTools({'), source.indexOf('const schemas'))
  const app = await readFile(join(ROOT, 'src', 'main', 'app.js'), 'utf8')
  const handedIn = app.slice(app.indexOf('const chat = createChat({'), app.indexOf('const timer ='))

  for (const reader of [
    'searchFiles',
    'searchNotes',
    'searchMessages',
    'music',
    'openPath',
    'inspectPath',
  ]) {
    assert.ok(handedIn.includes(reader), `app.js never hands the chat ${reader}`)
    assert.ok(forwarded.includes(reader), `session.js takes ${reader} but never forwards it`)
  }
})

test('a skipped track is taken back by asking for the previous one', async () => {
  const asked = []
  const music = {
    command: async (name) => {
      asked.push(name)
      return { player: 'Spotify', track: track('Suspended in Gaffa', 'Kate Bush') }
    },
    current: async () => null,
    playNamed: async () => ({ failed: 'not asked for here' }),
  }
  const tools = createTools({ actions: {}, getSnapshot: () => ({}), readNotes: async () => [], searchTasks: () => [], music })

  const outcome = await tools.control_music.run({ command: 'next' })
  assert.match(outcome.title, /^Skipped ahead · Spotify/)
  assert.match(outcome.told, /Skipped ahead on Spotify\. Now playing: Suspended in Gaffa — Kate Bush/)

  // Undo is the opposite command, not a repeat of the same one.
  await tools.control_music.undo(outcome)
  assert.deepEqual(asked, ['next', 'previous'])
})

test('putting an album on says what it interrupted, because undo only pauses', async () => {
  const asked = []
  const music = {
    command: async (name) => (asked.push(name), { player: 'Apple Music', track: null }),
    current: async () => track('Cloudbusting', 'Kate Bush', 'Apple Music'),
    playNamed: async (request) => (
      asked.push(request), { player: 'Apple Music', track: track('Sun', 'Caribou', 'Apple Music') }
    ),
  }
  const tools = createTools({ actions: {}, getSnapshot: () => ({}), readNotes: async () => [], searchTasks: () => [], music })

  const outcome = await tools.play_music.run({ name: 'Swim', kind: 'album' })
  assert.deepEqual(asked[0], { kind: 'album', name: 'Swim' })
  assert.match(outcome.told, /Playing Sun — Caribou on Apple Music/)

  // The Undo pill cannot restore a position no player will give back, so it says so
  // rather than claiming to have put the previous track on again.
  const undone = await tools.play_music.undo(outcome)
  assert.equal(asked.at(-1), 'pause')
  assert.match(undone, /Paused\. Before this, Cloudbusting — Kate Bush/)
})

test('a player that is closed refuses rather than being launched', async () => {
  const music = {
    command: async () => ({ failed: 'Neither Apple Music nor Spotify is open, so there is nothing to play.' }),
    current: async () => null,
    playNamed: async () => ({ failed: 'nope' }),
  }
  const tools = createTools({ actions: {}, getSnapshot: () => ({}), readNotes: async () => [], searchTasks: () => [], music })

  assert.match((await tools.control_music.run({ command: 'play' })).failed, /Neither Apple Music nor Spotify is open/)
  // And a command the model invented never reaches a player at all.
  assert.match((await tools.control_music.run({ command: 'shuffle' })).failed, /not one of play, pause/)
})

test('opening a file is proposed against a path that exists, and only the press opens it', async () => {
  const opened = []
  const tools = createTools({
    actions: {},
    getSnapshot: () => ({}),
    readNotes: async () => [],
    searchTasks: () => [],
    openPath: async (path, options) => (opened.push([path, options]), { opened: true }),
    inspectPath: async (path) => ({
      exists: path.endsWith('spec.pdf'),
      path,
      name: 'spec.pdf',
      directory: false,
    }),
  })

  assert.match((await tools.open_path.propose({ path: '/Users/me/gone.txt' })).failed, /Nothing exists at/)

  const proposal = await tools.open_path.propose({ path: '/Users/me/spec.pdf' })
  assert.match(proposal.title, /^Open · spec\.pdf/)
  assert.deepEqual(opened, [], 'proposing an open was enough to open it')

  await tools.open_path.run({ path: '/Users/me/spec.pdf', reveal: true })
  assert.deepEqual(opened, [['/Users/me/spec.pdf', { reveal: true }]])
})

test('locked messages hand back the reason, not an apology', async () => {
  const tools = createTools({
    actions: {},
    getSnapshot: () => ({}),
    readNotes: async () => [],
    searchTasks: () => [],
    searchMessages: async () => ({ blocked: true, hint: 'Full Disk Access → add Bananino' }),
  })

  // "I cannot see your messages" with no reason is a dead end; the switch to flip is the
  // only useful answer, so it travels to the model as the tool's result.
  assert.match(await tools.search_messages.read({ query: 'dinner' }), /Full Disk Access/)
})

test('a folder nobody has heard of is searched for, not asked about', async () => {
  // The report: "find 16x9_Architekt in the JuniorDepot folder" came back as "I don't know
  // where that is, give me the full path", three times over. The tool takes any folder
  // name now, and the brief says so in as many words — a model that asks for a path has
  // been told not to.
  let asked = null
  const tools = createTools({
    actions: {},
    getSnapshot: () => ({}),
    readNotes: async () => [],
    searchTasks: () => [],
    searchFiles: async (request) => {
      asked = request
      return {
        dirs: ['/Users/me/Work/JuniorDepot'],
        files: [{ path: '/Users/me/Work/JuniorDepot/16x9_Architekt.mp4', modified: new Date('2026-09-12T14:03:00Z') }],
      }
    },
  })

  const answer = await tools.search_files.read({ query: '16x9_Architekt', folder: 'JuniorDepot' })
  assert.deepEqual(asked, { query: '16x9_Architekt', folder: 'JuniorDepot', limit: 10 })
  // Where it looked is said once, above the paths: a search that quietly widened to the
  // whole Mac would otherwise hand back plausible hits from somewhere else entirely.
  assert.match(answer, /^In \/Users\/me\/Work\/JuniorDepot:/m)
  assert.match(answer, /16x9_Architekt\.mp4/)

  assert.match(SYSTEM, /Never ask the user where a folder is/)
  assert.match(tools.search_files.schema.function.description, /never ask the user where a folder is/)
})

test('a search that failed hands its own reason back, whole', async () => {
  // "The search couldn't run" taught the model to invent second explanations beside it.
  const tools = createTools({
    actions: {},
    getSnapshot: () => ({}),
    readNotes: async () => [],
    searchTasks: () => [],
    searchFiles: async () => ({
      failed: 'macOS is not letting Bananino into /Users/me/Downloads. System Settings → Privacy & Security → Files and Folders.',
    }),
  })

  const answer = await tools.search_files.read({ query: 'elevenlabs', folder: 'Downloads' })
  assert.match(answer, /Privacy & Security → Files and Folders/)
  assert.match(SYSTEM, /Repeat that reason/)
})
