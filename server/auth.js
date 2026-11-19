import { createHmac, timingSafeEqual } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'

const sessionCookieName = 'monsso_session'
const sessionLifetimeSeconds = 7 * 24 * 60 * 60
const googleClient = new OAuth2Client()

export class AuthError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
  }
}

function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new AuthError('Configure AUTH_SESSION_SECRET with at least 32 characters.', 503)
  }
  return secret
}

function createSessionToken(user, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    user,
    expiresAt: now + sessionLifetimeSeconds * 1000,
  })).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function readSessionToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null
  const [payload, signature, ...extra] = token.split('.')
  if (!payload || !signature || extra.length) return null

  const expected = createHmac('sha256', secret).update(payload).digest()
  let actual
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const { user, expiresAt } = session
    if (
      !user ||
      typeof user.email !== 'string' ||
      typeof expiresAt !== 'number' ||
      expiresAt <= now
    ) {
      return null
    }
    return user
  } catch {
    return null
  }
}

function getSessionCookie(request, secret) {
  const cookies = request.headers.cookie?.split(';') ?? []
  const cookie = cookies
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`))
  if (!cookie) return null
  return readSessionToken(cookie.slice(sessionCookieName.length + 1), secret)
}

function sessionCookie(value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${sessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new AuthError('Send a JSON request body.', 415)
  }

  if (request.body !== undefined) {
    const body = typeof request.body === 'string'
      ? request.body
      : JSON.stringify(request.body)
    if (Buffer.byteLength(body) > 8192) throw new AuthError('Request body is too large.', 413)
    try {
      const parsed = JSON.parse(body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected an object.')
      }
      return parsed
    } catch {
      throw new AuthError('Request body must contain a valid JSON object.')
    }
  }

  const chunks = []
  let totalBytes = 0
  for await (const chunk of request) {
    totalBytes += chunk.length
    if (totalBytes > 8192) throw new AuthError('Request body is too large.', 413)
    chunks.push(chunk)
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected an object.')
    }
    return parsed
  } catch {
    throw new AuthError('Request body must contain a valid JSON object.')
  }
}

async function verifyGoogleCredential(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new AuthError('Configure GOOGLE_CLIENT_ID on the API server.', 503)

  let payload
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId })
    payload = ticket.getPayload()
  } catch {
    throw new AuthError('Google could not verify this sign-in. Please try again.', 401)
  }

  if (
    !payload?.sub ||
    !payload.email ||
    payload.email_verified !== true
  ) {
    throw new AuthError('Use a Google account with a verified email address.', 401)
  }

  let picture = null
  if (typeof payload.picture === 'string') {
    try {
      if (new URL(payload.picture).protocol === 'https:') picture = payload.picture
    } catch {
      picture = null
    }
  }

  return {
    email: payload.email,
    picture,
  }
}

export async function handleAuthApi(request, response, route) {
  try {
    if (request.method === 'GET' && route === '/api/auth/me') {
      const secret = getSessionSecret()
      const user = getSessionCookie(request, secret)
      if (!user) {
        sendJson(response, 401, { error: 'You are not signed in.' })
        return
      }
      sendJson(response, 200, { user })
      return
    }

    if (request.method === 'POST' && route === '/api/auth/google') {
      const { credential } = await readJsonBody(request)
      if (typeof credential !== 'string' || credential.length === 0 || credential.length > 10000) {
        throw new AuthError('A valid Google credential is required.')
      }

      const user = await verifyGoogleCredential(credential)
      const token = createSessionToken(user, getSessionSecret())
      sendJson(response, 200, { user }, {
        'Set-Cookie': sessionCookie(token, sessionLifetimeSeconds),
      })
      return
    }

    if (request.method === 'POST' && route === '/api/auth/logout') {
      sendJson(response, 200, { signedOut: true }, {
        'Set-Cookie': sessionCookie('', 0),
      })
      return
    }

    sendJson(response, 404, { error: 'API route not found.' })
  } catch (error) {
    const statusCode = error instanceof AuthError ? error.statusCode : 502
    const message = error instanceof AuthError
      ? error.message
      : 'Google sign-in failed. Check the API server logs and Google configuration.'
    if (!(error instanceof AuthError)) {
      console.error('[api] Google sign-in failed:', error instanceof Error ? error.message : error)
    }
    sendJson(response, statusCode, { error: message })
  }
}
