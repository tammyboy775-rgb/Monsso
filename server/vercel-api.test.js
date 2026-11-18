import assert from 'node:assert/strict'
import test from 'node:test'
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
