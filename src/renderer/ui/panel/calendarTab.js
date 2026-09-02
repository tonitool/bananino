import { clear, el, setHidden } from '../dom.js'

const DURATIONS = [15, 30, 60, 90]
const LIST_LIMIT = 4

const timeOfDay = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const describeWhen = (event, now) => {
  const minutesAway = Math.round((event.startMs - now) / 60_000)
  const time = timeOfDay(event.startMs)
  if (minutesAway <= 0) return `${time} · now`
  return minutesAway < 60 ? `${time} · in ${minutesAway} min` : time
}

/** Today and the next quarter-hour are the boring-but-always-right defaults here. */
const defaultTimeField = (input) => {
  const next = new Date(Date.now() + 15 * 60_000)
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0)
  input.value = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
}

const todayField = (input) => {
  const now = new Date()
  input.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

/**
 * Calendar: what's coming up, and a small form for putting a new meeting on it. All the
 * talking to Composio and Microsoft happens in the main process; this tab only reflects
 * the snapshot and forwards intents.
 */
export const createCalendarTab = ({ onConnect, onLink, onDisconnect, onCreate, onJoin, onRecord, onRefresh }) => {
  const apiKey = el('input', {
    class: 'timer-input',
    type: 'password',
    placeholder: 'Composio API key',
    'aria-label': 'Composio API key',
    autocomplete: 'off',
  })
  const authConfigId = el('input', {
    class: 'timer-input',
    type: 'text',
    placeholder: 'Auth config ID (optional)',
    'aria-label': 'Composio auth config ID',
    autocomplete: 'off',
  })

  const connectButton = el('button', {
    class: 'button button--primary',
    type: 'button',
    text: 'Connect',
    onclick: () => {
      // Cleared immediately: it is saved encrypted in the main process, not kept here.
      const payload = { apiKey: apiKey.value.trim(), authConfigId: authConfigId.value.trim() }
      apiKey.value = ''
      onConnect(payload)
    },
  })

  const linkButton = el('button', {
    class: 'button button--primary',
    type: 'button',
    text: 'Link Microsoft account',
    onclick: () => onLink(),
  })

  const connectView = el('div', { class: 'cal-connect' }, [
    el('p', {
      class: 'hint',
      text: 'Bananino reads your Outlook/Teams calendar via Composio, which holds the Microsoft sign-in. The key is stored in your Keychain.',
    }),
    apiKey,
    authConfigId,
    connectButton,
  ])

  const linkView = el('div', { class: 'cal-connect' }, [
    el('p', { class: 'hint', text: 'Key saved — one more step:' }),
    linkButton,
    el('p', { class: 'hint', text: 'This opens your browser once so Microsoft can say yes.' }),
  ])

  const list = el('ul', { class: 'cal-list', 'aria-label': 'Upcoming meetings' })
  const error = el('p', { class: 'cal-error', role: 'alert' })

  const title = el('input', {
    class: 'timer-input',
    type: 'text',
    placeholder: 'New meeting title',
    'aria-label': 'New meeting title',
  })
  const date = el('input', { class: 'timer-input timer-input--slim', type: 'date', 'aria-label': 'Date' })
  const startTime = el('input', { class: 'timer-input timer-input--slim', type: 'time', 'aria-label': 'Start time' })
  const attendees = el('input', {
    class: 'timer-input',
    type: 'text',
    placeholder: 'Invitees (emails, optional)',
    'aria-label': 'Invitees',
  })

  let minutes = 30
  let isLinked = false
  const durationButtons = DURATIONS.map((value) =>
    el('button', {
      class: 'submode',
      type: 'button',
      text: `${value}m`,
      onclick: () => pick(value),
    }),
  )
  const pick = (value) => {
    minutes = value
    for (const [index, button] of durationButtons.entries()) {
      button.setAttribute('aria-selected', String(DURATIONS[index] === value))
    }
  }
  pick(30)

  const online = el('input', { type: 'checkbox', checked: true })
  const onlineLabel = el('label', { class: 'cal-check' }, [online, 'Teams link'])

  const createButton = el('button', {
    class: 'button button--primary',
    type: 'button',
    text: 'Create meeting',
    onclick: () => {
      const payload = {
        title: title.value.trim(),
        date: date.value,
        startTime: startTime.value,
        minutes,
        online: online.checked,
        attendees: attendees.value,
      }
      title.value = ''
      attendees.value = ''
      onCreate(payload)
    },
  })

  const noneHint = el('p', { class: 'cal-none hint', text: 'Nothing on the horizon.' })

  const linkedView = el('div', { class: 'cal-live' }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'hint', text: 'Coming up' }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'link', type: 'button', text: 'Refresh', onclick: onRefresh }),
    ]),
    list,
    noneHint,
    el('hr', { class: 'cal-sep' }),
    title,
    el('div', { class: 'row' }, [date, startTime]),
    el('div', { class: 'submodes', role: 'tablist' }, durationButtons),
    attendees,
    el('div', { class: 'row' }, [onlineLabel, el('span', { class: 'spacer' }), createButton]),
  ])

  const unlinkButton = el('button', {
    class: 'link cal-unlink',
    type: 'button',
    text: 'Disconnect calendar',
    onclick: onDisconnect,
  })

  // The error lives outside the three views so a failed link check is visible in all of them.
  const root = el('section', { class: 'tab-panel', id: 'tab-calendar', role: 'tabpanel' }, [
    connectView,
    linkView,
    linkedView,
    error,
    unlinkButton,
  ])

  todayField(date)
  defaultTimeField(startTime)

  const renderEvents = (upcoming, meetingActive) => {
    clear(list)
    const now = Date.now()
    for (const event of upcoming.slice(0, LIST_LIMIT)) {
      list.append(
        el('li', { class: 'cal-event' }, [
          el('span', { class: 'cal-when', text: describeWhen(event, now) }),
          el('span', { class: 'cal-title', text: event.title }),
          el('span', { class: 'cal-actions' }, [
            event.joinUrl
              ? el('button', {
                  class: 'button--small link',
                  type: 'button',
                  text: 'Join',
                  onclick: () => onJoin(event.joinUrl),
                })
              : null,
            el('button', {
              class: 'button--small link',
              type: 'button',
              text: 'Record',
              disabled: meetingActive || null,
              onclick: () => onRecord(event.title),
            }),
          ]),
        ]),
      )
    }
    setHidden(list, upcoming.length === 0)
    setHidden(noneHint, upcoming.length > 0)
  }

  const update = (snapshot) => {
    const calendar = snapshot.calendar ?? { linked: false, linking: false, upcoming: [] }
    const meetingActive = snapshot.meeting?.phase === 'recording'

    setHidden(connectView, calendar.keySaved || calendar.linked)
    setHidden(linkView, !calendar.keySaved || calendar.linked)
    setHidden(linkedView, !calendar.linked)
    setHidden(unlinkButton, !calendar.linked)

    linkButton.disabled = calendar.linking
    linkButton.textContent = calendar.linking ? 'Waiting for the browser…' : 'Link Microsoft account'

    renderEvents(calendar.upcoming ?? [], meetingActive)

    error.textContent = calendar.lastError ?? ''
    setHidden(error, !calendar.lastError)

    isLinked = Boolean(calendar.linked)
  }

  return { root, update, focus: () => (isLinked ? title : apiKey).focus() }
}
