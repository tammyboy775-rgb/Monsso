import assert from 'node:assert/strict'
import test from 'node:test'
import { handleAuthApi } from './auth.js'

function createResponse() {
  return {
    headers: {},
    writeHead(statusCode, headers) {
      this.statusCode = statusCode
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }
}

test('profile endpoint rejects requests without a valid signed-in session', async () => {
  const previousSecret = process.env.AUTH_SESSION_SECRET
  process.env.AUTH_SESSION_SECRET = 'test-secret-with-more-than-32-characters'
  const response = createResponse()

  try {
    await handleAuthApi(
      { method: 'GET', headers: { cookie: 'monsso_session=not-a-valid-session' } },
      response,
      '/api/auth/me',
    )

    assert.equal(response.statusCode, 401)
    assert.deepEqual(JSON.parse(response.body), { error: 'You are not signed in.' })
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SESSION_SECRET
    else process.env.AUTH_SESSION_SECRET = previousSecret
  }
})

test('logout clears the HTTP-only session cookie', async () => {
  const response = createResponse()

  await handleAuthApi(
    { method: 'POST', headers: {} },
    response,
    '/api/auth/logout',
  )

  assert.equal(response.statusCode, 200)
  assert.match(response.headers['Set-Cookie'], /HttpOnly/)
  assert.match(response.headers['Set-Cookie'], /SameSite=Lax/)
  assert.match(response.headers['Set-Cookie'], /Max-Age=0/)
})
