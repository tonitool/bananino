import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MocoError,
  baseUrl,
  buildRequest,
  createActivity,
  fetchAssignedProjects,
  normaliseSubdomain,
} from '../src/main/moco/client.js'
import { flattenProjects, relabel, searchTasks } from '../src/main/moco/catalogue.js'
import { addEntry, markFailed, removeEntries, toActivity, toHours } from '../src/main/moco/queueOps.js'

test('subdomains are accepted in the forms people actually paste', () => {
  assert.equal(normaliseSubdomain('acme'), 'acme')
  assert.equal(normaliseSubdomain('  ACME  '), 'acme')
  assert.equal(normaliseSubdomain('acme.mocoapp.com'), 'acme')
  assert.equal(normaliseSubdomain('https://acme.mocoapp.com/projects'), 'acme')
  assert.equal(baseUrl('acme'), 'https://acme.mocoapp.com/api/v1')
})

test('a subdomain cannot smuggle the API key to another host', () => {
  // The key is attached to every request, so the host it reaches must be constrained.
  for (const bad of ['evil.com/', 'a b', '../../x', 'acme.evil', '', 'https://evil.com#']) {
    assert.throws(() => normaliseSubdomain(bad), MocoError, `should reject ${JSON.stringify(bad)}`)
  }
})

test('seconds become MOCO hours, and a short stint never rounds to zero', () => {
  assert.equal(toHours(3600), 1)
  assert.equal(toHours(5400), 1.5)
  assert.equal(toHours(1800), 0.5)
  assert.equal(toHours(60), 0.02)
  assert.equal(toHours(5), 0.01, 'a five second entry must still be loggable')
  assert.equal(toHours(0), 0.01)
})

test('an entry becomes exactly the payload MOCO documents', () => {
  const entry = {
    id: 'a1',
    date: '2026-09-01',
    projectId: 944739918,
    taskId: 1729356,
    hours: 1.25,
    description: 'Client onboarding',
    label: 'Acme · Onboarding · Design',
  }
  assert.deepEqual(toActivity(entry), {
    date: '2026-09-01',
    project_id: 944739918,
    task_id: 1729356,
    hours: 1.25,
    description: 'Client onboarding',
  })
})

test('queue operations do not mutate the array they are given', () => {
  const queue = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(removeEntries(queue, ['a']), [{ id: 'b' }])
  assert.deepEqual(queue, [{ id: 'a' }, { id: 'b' }], 'original untouched')

  const failed = markFailed(queue, 'b', 'HTTP 422')
  assert.equal(failed[1].error, 'HTTP 422')
  assert.equal(failed[1].attempts, 1)
  assert.equal(queue[1].attempts, undefined)
  assert.equal(addEntry(queue, { id: 'c' }).length, 3)
})

test('assigned projects flatten into bookable tasks', () => {
  const flat = flattenProjects([
    {
      id: 1234,
      name: 'Application',
      customer: { id: 4567, name: 'A Company' },
      tasks: [
        { id: 573383, name: 'Integrations', billable: true },
        { id: 573384, name: 'Meetings', billable: false },
      ],
    },
    { id: 9, name: 'No tasks', customer: { name: 'B' } },
  ])

  assert.equal(flat.length, 2)
  assert.deepEqual(flat[0], {
    projectId: 1234,
    taskId: 573383,
    customer: 'A Company',
    project: 'Application',
    task: 'Integrations',
    billable: true,
    // Project first, then role — the order MOCO asks for, and the order that
    // distinguishes two projects that share a role name.
    label: 'Application — Integrations',
    detail: 'A Company · Integrations',
  })
  assert.equal(flat[1].billable, false)
})

test('search matches words in any order across project and role', () => {
  const entries = flattenProjects([
    {
      id: 1,
      name: 'Onboarding',
      customer: { name: 'Acme' },
      tasks: [{ id: 10, name: 'Design' }, { id: 11, name: 'Development' }],
    },
    { id: 2, name: 'Design System', customer: { name: 'Beta' }, tasks: [{ id: 12, name: 'Review' }] },
  ])

  assert.equal(searchTasks(entries, 'onb design')[0].taskId, 10, 'words may be out of order')
  assert.equal(searchTasks(entries, 'onboarding').length, 2, 'a project matches all its roles')
  assert.equal(searchTasks(entries, 'zzz').length, 0)
  assert.equal(searchTasks(entries, '').length, 3, 'empty query lists everything')

  // Two projects sharing a role name stay distinguishable by their labels.
  const shared = flattenProjects([
    { id: 1, name: 'New Biz', customer: { name: 'Clue One' }, tasks: [{ id: 1, name: 'Beratung' }] },
    { id: 2, name: 'Selbstorganisation', customer: { name: 'Clue One' }, tasks: [{ id: 2, name: 'Beratung' }] },
  ])
  assert.deepEqual(
    shared.map((entry) => entry.label),
    ['New Biz — Beratung', 'Selbstorganisation — Beratung'],
  )
})

test('the activity request matches what MOCO documents', () => {
  // Asserts the shipped request builder, not a hand-rolled copy of it.
  const activity = toActivity({
    id: 'a1',
    date: '2026-09-01',
    projectId: 944739918,
    taskId: 1729356,
    hours: 1,
    description: 'Onboarding',
  })
  const { url, init } = buildRequest({
    subdomain: 'acme',
    apiKey: 'SECRET',
    path: '/activities',
    method: 'POST',
    body: activity,
  })

  assert.equal(url, 'https://acme.mocoapp.com/api/v1/activities')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.Authorization, 'Token token=SECRET')
  assert.equal(init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(init.body), activity)
})

test('a GET carries no body and still authenticates', () => {
  const { url, init } = buildRequest({
    subdomain: 'acme',
    apiKey: 'SECRET',
    path: '/projects/assigned?active=true',
  })
  assert.equal(url, 'https://acme.mocoapp.com/api/v1/projects/assigned?active=true')
  assert.equal(init.method, 'GET')
  assert.equal(init.body, undefined)
  assert.equal(init.headers.Authorization, 'Token token=SECRET')
})

test('an unreachable host is reported as a MocoError, not a raw fetch failure', async () => {
  await assert.rejects(
    () => fetchAssignedProjects({ subdomain: 'definitely-not-a-real-moco-tenant-xyz', apiKey: 'k' }),
    (error) => error instanceof MocoError,
  )
})

test('createActivity refuses an invalid subdomain before sending anything', async () => {
  await assert.rejects(
    () => createActivity({ subdomain: 'evil.com/', apiKey: 'k', activity: {} }),
    MocoError,
  )
})

test('labels are re-derived when loading a catalogue written by an older build', () => {
  // A cache from a previous format used "Customer · Project · Task"; trusting it put the
  // wrong text into new entries.
  const stale = {
    projectId: 1,
    taskId: 2,
    customer: 'Clue One Digital GmbH',
    project: 'Selbstorganisation',
    task: 'Clue One Beratung',
    billable: false,
    label: 'Clue One Digital GmbH · Selbstorganisation · Clue One Beratung',
  }
  assert.equal(relabel(stale).label, 'Selbstorganisation — Clue One Beratung')
  assert.equal(relabel(stale).detail, 'Clue One Digital GmbH · Clue One Beratung')
})
