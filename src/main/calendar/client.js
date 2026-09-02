import { COMPOSIO } from '../constants.js'

export class ComposioError extends Error {
  constructor(message, { status, hint } = {}) {
    super(message)
    this.name = 'ComposioError'
    this.status = status
    this.hint = hint
  }
}

const describeStatus = (status) => {
  if (status === 401 || status === 403) {
    return {
      message: 'Composio rejected the API key.',
      hint: 'Check the key in your Composio dashboard.',
    }
  }
  if (status === 404) return { message: 'Composio could not find that endpoint.' }
  if (status === 429) return { message: 'Composio is rate limiting; try again shortly.' }
  return { message: `Composio returned HTTP ${status}.` }
}

/**
 * The exact request that goes to Composio, separated from sending so the wire format can
 * be asserted directly. One auditable place where the key attaches: the x-api-key header,
 * and only to the fixed Composio base URL.
 */
export const buildRequest = ({ apiKey, path, method = 'GET', body }) => ({
  url: `${COMPOSIO.baseUrl}${path}`,
  init: {
    method,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  },
})

const request = async ({ apiKey, path, method = 'GET', body, signal }) => {
  const { url, init } = buildRequest({ apiKey, path, method, body })

  const response = await fetch(url, {
    ...init,
    signal: signal ?? AbortSignal.timeout(COMPOSIO.timeoutMs),
  }).catch((error) => {
    throw new ComposioError(`Could not reach Composio: ${error.message}`, {
      hint: 'Check your connection.',
    })
  })

  if (!response.ok) {
    const { message, hint } = describeStatus(response.status)
    const detail = await response.text().catch(() => '')
    throw new ComposioError(`${message} ${detail}`.trim(), { status: response.status, hint })
  }

  return response.status === 204 ? null : response.json()
}

/** The tools list doubles as the cheapest way to prove a key works. */
export const listTools = async ({ apiKey, toolkit = COMPOSIO.toolkit, signal }) => {
  const result = await request({
    apiKey,
    path: `/tools?toolkit_slug=${encodeURIComponent(toolkit)}`,
    signal,
  })
  const items = result?.items ?? result
  const slugs = (Array.isArray(items) ? items : [])
    .map((tool) => tool?.slug)
    .filter((slug) => typeof slug === 'string')
  return slugs
}

export const listAuthConfigs = async ({ apiKey, toolkit = COMPOSIO.toolkit, signal }) => {
  const result = await request({
    apiKey,
    path: `/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}`,
    signal,
  })
  const items = result?.items ?? result
  return Array.isArray(items) ? items : []
}

/** Composio-managed OAuth config for a toolkit; created once, reused on later links. */
export const createAuthConfig = ({ apiKey, toolkit = COMPOSIO.toolkit, signal }) =>
  request({
    apiKey,
    path: '/auth_configs',
    method: 'POST',
    body: {
      toolkit: { slug: toolkit },
      auth_config: { type: 'use_composio_managed_auth' },
    },
    signal,
  })

/**
 * Starts an OAuth flow the user completes in the browser. The link endpoint is the
 * current one for Composio-managed auth; the plain connected_accounts POST is its
 * deprecated twin, and both shapes are read for the redirect URL on the way back.
 */
export const createLinkSession = async ({ apiKey, authConfigId, signal }) => {
  const session = await request({
    apiKey,
    path: '/connected_accounts/link',
    method: 'POST',
    body: {
      auth_config_id: authConfigId,
      user_id: COMPOSIO.userId,
    },
    signal,
  })

  const redirectUrl = session?.redirect_url ?? session?.redirect_uri ?? null
  if (!redirectUrl) {
    throw new ComposioError('Composio did not return a sign-in link.', {
      hint: 'Check the auth config in your Composio dashboard.',
    })
  }

  return {
    redirectUrl,
    accountId: session?.connected_account_id ?? session?.connectedAccountId ?? null,
    linkToken: session?.link_token ?? null,
  }
}

export const getAccount = ({ apiKey, accountId, signal }) =>
  request({ apiKey, path: `/connected_accounts/${encodeURIComponent(accountId)}`, signal })

export const accountIsActive = (account) => {
  const status = account?.status ?? account?.connectionData?.status
  return String(status ?? '').toUpperCase() === 'ACTIVE'
}

/** Runs one Composio action for this installation's single user. */
export const executeAction = ({ apiKey, slug, args, signal }) =>
  request({
    apiKey,
    path: `/tools/execute/${encodeURIComponent(slug)}`,
    method: 'POST',
    body: { user_id: COMPOSIO.userId, arguments: args },
    signal,
  })
