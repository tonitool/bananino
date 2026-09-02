import { CALENDAR, COMPOSIO } from '../constants.js'
import * as composioClient from './client.js'
import { buildCreateArgs, dueReminders, pickSlug, upcomingFrom } from './events.js'

const HORIZON_MS = CALENDAR.horizonHours * 60 * 60 * 1000

// Reminders die with the process; this just stops a long-lived app from growing it forever.
const REMINDED_CAP = 500

/**
 * Owns the calendar connection: the Composio key, the linked Microsoft account, the
 * polling that keeps upcoming meetings fresh, and the reminders that result from them.
 *
 * Two gates, deliberately separate: the API key proves we may talk to Composio, and the
 * account link proves the calendar owner agreed. Either can be missing without the other.
 *
 * `keys` is passed in rather than imported: the real store lives behind an `electron`
 * import, which cannot load in a plain Node test. `api` defaults to the Composio client;
 * tests substitute both. Production wiring happens in app.js.
 */
export const createCalendarSync = ({
  getSettings,
  saveSettings,
  onChange,
  onReminder,
  keys,
  api = composioClient,
}) => {
  let slugs = { list: null, create: null }
  let events = []
  let linked = false
  let linking = false
  let keySaved = false
  let lastError = null
  let lastPollAt = 0
  let poller = null
  let polling = false
  const reminded = new Set()

  const notify = () => onChange?.()

  const upcomingWindow = () =>
    events.filter((event) => event.endMs > Date.now()).slice(0, 5)

  const status = () => ({
    available: keys.isSecureStorageAvailable(),
    keySaved,
    linked,
    linking,
    upcoming: upcomingWindow(),
    lastError,
    lastPollAt,
  })

  const clearLinkSettings = () =>
    saveSettings({ calendarAuthConfigId: '', calendarAccountId: '' })

  /** The tool list is also account capability discovery: slugs differ between orgs. */
  const discoverSlugs = async (apiKey) => {
    const available = await api.listTools({ apiKey })
    slugs = {
      list: pickSlug(available, COMPOSIO.listSlugs),
      create: pickSlug(available, COMPOSIO.createSlugs),
    }
    return available.length
  }

  const start = async () => {
    linked = false
    keySaved = await keys.hasApiKey()
    if (!keySaved) return notify()
    const accountId = getSettings().calendarAccountId
    if (!accountId) return notify()

    try {
      const apiKey = await keys.readApiKey()
      const account = await api.getAccount({ apiKey, accountId })
      linked = api.accountIsActive(account)
      if (linked) {
        await discoverSlugs(apiKey)
        startPolling()
        void pollNow()
      }
    } catch (error) {
      lastError = error.message
      console.warn('[calendar] start failed:', error.message)
    }
    notify()
  }

  const startPolling = () => {
    if (poller) return
    poller = setInterval(() => {
      void pollNow()
    }, CALENDAR.pollMs)
    // Never the reason a process stays alive — Electron's app loop is that already.
    poller.unref?.()
  }

  /** The verified key is persisted; a key that fails is never stored. */
  const connect = async ({ apiKey, authConfigId }) => {
    const toolCount = await discoverSlugs(apiKey)
    if (toolCount === 0) {
      throw new Error('Composio has no Outlook tools listed.', {
        cause: 'no-tools',
      })
    }
    await keys.saveApiKey(apiKey)
    keySaved = true
    // An empty field means "the stored one stays" — retyping the key must not force
    // the link flow to rediscover the auth config.
    saveSettings({
      calendarAuthConfigId:
        String(authConfigId ?? '').trim() || getSettings().calendarAuthConfigId || '',
    })
    lastError = null

    const accountId = getSettings().calendarAccountId
    if (accountId) {
      try {
        linked = api.accountIsActive(await api.getAccount({ apiKey, accountId }))
      } catch (error) {
        console.warn('[calendar] stored account could not be re-checked:', error.message)
        linked = false
      }
      if (linked) {
        startPolling()
        void pollNow()
      }
    }
    notify()
    return status()
  }

  /**
   * Gives back the URL the user must open in a browser. Completing it is asynchronous by
   * nature: the renderer starts polling via linkDone afterwards.
   */
  const beginLink = async () => {
    const apiKey = await keys.readApiKey()
    if (!apiKey) throw new Error('Connect the Composio API key first.')

    let authConfigId = getSettings().calendarAuthConfigId
    if (!authConfigId) {
      const configs = await api.listAuthConfigs({ apiKey })
      authConfigId = configs[0]?.id ?? (await api.createAuthConfig({ apiKey }))?.id ?? ''
      if (!authConfigId) {
        throw new Error(
          'No Outlook auth config found. Create one for the Outlook toolkit in the Composio dashboard and paste its ID in the Calendar tab.',
        )
      }
      saveSettings({ calendarAuthConfigId: authConfigId })
    }

    const session = await api.createLinkSession({ apiKey, authConfigId })
    if (session.accountId) saveSettings({ calendarAccountId: session.accountId })
    linking = true
    lastError = null
    notify()
    return session
  }

  /**
   * The user closed the consent page without finishing, or it timed out: back to
   * "key saved, link me" rather than a Link button that stays disabled forever.
   */
  const cancelLink = () => {
    if (!linking) return
    linking = false
    notify()
  }

  /** Called on a timer by the app while the link flow is open in the browser. */
  const checkLink = async () => {
    const accountId = getSettings().calendarAccountId
    const apiKey = await keys.readApiKey()
    if (!apiKey || !accountId) return false

    const account = await api.getAccount({ apiKey, accountId })
    linked = api.accountIsActive(account)
    linking = !linked

    if (linked) {
      await discoverSlugs(apiKey).catch((error) =>
        console.warn('[calendar] tool discovery after link failed:', error.message),
      )
      startPolling()
      void pollNow()
    }
    notify()
    return linked
  }

  const disconnect = async () => {
    await keys.forgetApiKey()
    clearLinkSettings()
    linked = false
    linking = false
    keySaved = false
    events = []
    slugs = { list: null, create: null }
    lastError = null
    stop()
    notify()
  }

  const pollNow = async () => {
    if (!linked || polling) return
    polling = true

    const apiKey = await keys.readApiKey()
    if (!apiKey) {
      polling = false
      return
    }

    try {
      if (!slugs.list) await discoverSlugs(apiKey)
      if (!slugs.list) throw new Error('This Composio account lists no Outlook calendar tool.')

      // A view action takes a time window; a plain list action ignores what it does not
      // know — either way, filtering locally decides what is actually upcoming.
      const result = await api.executeAction({
        apiKey,
        slug: slugs.list,
        args: {
          start_date_time: new Date(Date.now()).toISOString(),
          end_date_time: new Date(Date.now() + HORIZON_MS).toISOString(),
          startDateTime: new Date(Date.now()).toISOString(),
          endDateTime: new Date(Date.now() + HORIZON_MS).toISOString(),
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })

      events = upcomingFrom(result, Date.now(), HORIZON_MS)
      lastError = null
      lastPollAt = Date.now()

      if (reminded.size > REMINDED_CAP) reminded.clear()

      for (const { event, kind, key } of dueReminders(
        events,
        Date.now(),
        reminded,
        CALENDAR.remindMinutes,
        CALENDAR.startGraceMinutes,
      )) {
        reminded.add(key)
        onReminder?.(event, kind)
      }
    } catch (error) {
      lastError = error.message
      console.warn('[calendar] poll failed:', error.message)
    }
    polling = false
    notify()
  }

  const createMeeting = async ({ title, startMs, minutes, online, attendees }) => {
    const apiKey = await keys.readApiKey()
    if (!apiKey || !linked) throw new Error('Calendar is not linked yet.')
    if (!slugs.create) await discoverSlugs(apiKey)
    if (!slugs.create) throw new Error('This Composio account has no Outlook create-event tool.')

    const args = buildCreateArgs({
      title,
      startMs,
      minutes,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      online,
      attendees,
    })
    const result = await api.executeAction({ apiKey, slug: slugs.create, args })

    const created = result?.data ?? result ?? {}
    const joinUrl =
      created?.onlineMeeting?.joinUrl ?? created?.onlineMeetingUrl ?? created?.event?.onlineMeeting?.joinUrl ?? null

    void pollNow()
    return { subject: created?.subject ?? title, joinUrl, webLink: created?.webLink ?? null }
  }

  const stop = () => {
    if (poller) clearInterval(poller)
    poller = null
  }

  return {
    start,
    connect,
    beginLink,
    checkLink,
    cancelLink,
    disconnect,
    pollNow,
    createMeeting,
    status,
    isLinked: () => linked,
    upcoming: upcomingWindow,
    capabilities: () => ({ ...slugs }),
    stop,
  }
}
