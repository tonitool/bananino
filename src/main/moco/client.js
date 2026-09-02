const REQUEST_TIMEOUT_MS = 20_000

export class MocoError extends Error {
  constructor(message, { status, hint } = {}) {
    super(message)
    this.name = 'MocoError'
    this.status = status
    this.hint = hint
  }
}

/** Subdomains reach a real host, so they are validated rather than interpolated blindly. */
export const normaliseSubdomain = (value) => {
  const trimmed = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.mocoapp\.com.*$/, '')
    .replace(/\/.*$/, '')

  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(trimmed)) {
    throw new MocoError(`"${value}" is not a valid MOCO subdomain.`, {
      hint: 'Use just the name, as in "acme" for acme.mocoapp.com.',
    })
  }
  return trimmed
}

export const baseUrl = (subdomain) => `https://${normaliseSubdomain(subdomain)}.mocoapp.com/api/v1`

const describeStatus = (status) => {
  if (status === 401 || status === 403) {
    return { message: 'MOCO rejected the API key.', hint: 'Check the key in MOCO → Profile → Integrations.' }
  }
  if (status === 404) return { message: 'MOCO could not find that endpoint.', hint: 'Check the subdomain.' }
  if (status === 422) return { message: 'MOCO rejected the entry as invalid.' }
  if (status === 429) return { message: 'MOCO is rate limiting; try again shortly.' }
  return { message: `MOCO returned HTTP ${status}.` }
}

/**
 * Builds the exact request that goes to MOCO. Separated from sending so the wire format
 * can be asserted directly, and so there is one auditable place where the API key is
 * attached — always to a URL derived from a validated subdomain, never an arbitrary host.
 */
export const buildRequest = ({ subdomain, apiKey, path, method = 'GET', body }) => ({
  url: `${baseUrl(subdomain)}${path}`,
  init: {
    method,
    headers: {
      Authorization: `Token token=${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  },
})

const request = async ({ subdomain, apiKey, path, method = 'GET', body, signal }) => {
  const { url, init } = buildRequest({ subdomain, apiKey, path, method, body })

  const response = await fetch(url, {
    ...init,
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((error) => {
    throw new MocoError(`Could not reach MOCO: ${error.message}`, {
      hint: 'Check the subdomain and your connection.',
    })
  })

  if (!response.ok) {
    const { message, hint } = describeStatus(response.status)
    const detail = await response.text().catch(() => '')
    throw new MocoError(`${message} ${detail}`.trim(), { status: response.status, hint })
  }

  return response.status === 204 ? null : response.json()
}

export const fetchAssignedProjects = ({ subdomain, apiKey, signal }) =>
  request({ subdomain, apiKey, path: '/projects/assigned?active=true', signal })

/** The activity is always created for the user the API key belongs to. */
export const createActivity = ({ subdomain, apiKey, activity, signal }) =>
  request({ subdomain, apiKey, path: '/activities', method: 'POST', body: activity, signal })

export const testConnection = async ({ subdomain, apiKey, signal }) => {
  const projects = await fetchAssignedProjects({ subdomain, apiKey, signal })
  return { projectCount: Array.isArray(projects) ? projects.length : 0, projects }
}
