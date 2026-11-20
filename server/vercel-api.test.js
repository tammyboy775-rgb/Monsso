import assert from 'node:assert/strict'
import test from 'node:test'
import apiHandler, { getApiRoute } from '../api/index.js'
import { handleVercelApi } from './vercel-api.js'

test('health endpoint reports missing configuration as JSON without exposing values', async () => {
  const required = [
    'OP_CLIENT_WALLET_ADDRESS',
    'OP_MERCHANT_WALLET_ADDRESS',
    'OP_PRIVATE_KEY',
    'OP_KEY_ID',
    'MONSSO_APP_ORIGIN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ]
  const previous = new Map(required.map((name) => [name, process.env[name]]))
  for (const name of required) delete process.env[name]

  const response = {
    headers: {},
    writeHead(statusCode, headers) {
      this.statusCode = statusCode
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }

  try {
    await handleVercelApi(
      { method: 'GET', headers: {} },
      response,
      '/api/health',
    )

    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8')
    assert.equal(response.headers['Cache-Control'], 'no-store')
    assert.deepEqual(JSON.parse(response.body), {
      configured: false,
      missing: required,
    })
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('shared API function reconstructs the route from the Vercel rewrite', () => {
  assert.equal(
    getApiRoute({ query: {
      route: 'automation/split/123e4567-e89b-12d3-a456-426614174000',
    } }),
    '/api/automation/split/123e4567-e89b-12d3-a456-426614174000',
  )
})

test('shared API function requires sign-in for workflow routes', async () => {
  const previousSecret = process.env.AUTH_SESSION_SECRET
  process.env.AUTH_SESSION_SECRET = 'test-session-secret-with-more-than-32-characters'
  const response = {
    writeHead(statusCode) {
      this.statusCode = statusCode
    },
    end(body) {
      this.body = body
    },
  }

  try {
    await apiHandler(
      {
        method: 'GET',
        url: '/api?route=automation%2Fsplit%2F123e4567-e89b-12d3-a456-426614174000',
        query: { route: 'automation/split/123e4567-e89b-12d3-a456-426614174000' },
        headers: {},
      },
      response,
    )
    assert.equal(response.statusCode, 401)
    assert.match(JSON.parse(response.body).error, /Sign in/)
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SESSION_SECRET
    else process.env.AUTH_SESSION_SECRET = previousSecret
  }
})
