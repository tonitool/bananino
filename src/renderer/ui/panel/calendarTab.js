import { clear, el, setHidden } from '../dom.js'

const LIST_LIMIT = 4

const timeOfDay = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const describeWhen = (event, now) => {
  const minutesAway = Math.round((event.startMs - now) / 60_000)
  const time = timeOfDay(event.startMs)
  if (minutesAway <= 0) return `${time} · now`
  return minutesAway < 60 ? `${time} · in ${minutesAway} min` : time
}

/**
 * The feed-based calendar: one published ICS link, read-only by design. Meeting creation
 * needs write access, which means OAuth — that path returns when it exists; until then,
 * create meetings in Outlook and they show up here.
 */
export const createCalendarTab = ({ onConnect, onDisconnect, onJoin, onRecord, onRefresh }) => {
  const feedUrl = el('input', {
    class: 'timer-input',
    type: 'password',
    placeholder: 'Published calendar link (…/calendar.ics)',
    'aria-label': 'Published calendar link',
    autocomplete: 'off',
  })

  const connectButton = el('button', {
    class: 'button button--primary',
    type: 'button',
    text: 'Connect',
    onclick: () => {
      // Cleared immediately: it is stored encrypted in the main process, not kept here.
      const url = feedUrl.value.trim()
      feedUrl.value = ''
      onConnect({ feedUrl: url })
    },
  })

  const connectView = el('div', { class: 'cal-connect' }, [
    el('p', {
      class: 'hint',
      text: 'Outlook → Settings → Calendar → Shared calendars → “Publish a calendar”, full details, ICS — paste the link here. It is stored in your Keychain; anyone holding it can read that calendar.',
    }),
    feedUrl,
    connectButton,
  ])

  const list = el('ul', { class: 'cal-list', 'aria-label': 'Upcoming meetings' })
  const noneHint = el('p', { class: 'cal-none hint', text: 'Nothing on the horizon.' })
  const error = el('p', { class: 'cal-error', role: 'alert' })

  const linkedView = el('div', { class: 'cal-live' }, [
    el('div', { class: 'row' }, [
      el('span', { class: 'hint', text: 'Coming up' }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'link', type: 'button', text: 'Refresh', onclick: onRefresh }),
    ]),
    list,
    noneHint,
    el('p', {
      class: 'hint',
      text: 'Read-only: the buddy watches this calendar. It can lag new edits by a few minutes — that is the feed, not the app.',
    }),
  ])

  const unlinkButton = el('button', {
    class: 'link cal-unlink',
    type: 'button',
    text: 'Disconnect calendar',
    onclick: onDisconnect,
  })

  // The error lives outside both views so failures are visible connected or not.
  const root = el('section', { class: 'tab-panel', id: 'tab-calendar', role: 'tabpanel' }, [
    connectView,
    linkedView,
    error,
    unlinkButton,
  ])

  let isConnected = false

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
    const calendar = snapshot.calendar ?? { connected: false, upcoming: [] }
    const meetingActive = snapshot.meeting?.phase === 'recording'
    isConnected = Boolean(calendar.connected)

    setHidden(connectView, isConnected)
    setHidden(linkedView, !isConnected)
    setHidden(unlinkButton, !isConnected)

    renderEvents(calendar.upcoming ?? [], meetingActive)

    error.textContent = calendar.lastError ?? ''
    setHidden(error, !calendar.lastError)
  }

  return {
    root,
    update,
    // Connected users have a list to read, not a field to type into.
    focus: () => {
      if (!isConnected) feedUrl.focus()
    },
  }
}
