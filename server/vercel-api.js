import { createHash } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { createAuthenticatedClient } from '@interledger/open-payments'
import { AuthError, getAuthenticatedUser, handleAuthApi } from './auth.js'
import {
  createOpenPaymentsService,
  isTestnetWalletAddress,
  PaymentError,
} from './payments.js'
import { createOpenPaymentsWorkflowService } from './workflows.js'

const requiredEnvironment = [
  'OP_CLIENT_WALLET_ADDRESS',
  'OP_MERCHANT_WALLET_ADDRESS',
  'OP_PRIVATE_KEY',
  'OP_KEY_ID',
  'MONSSO_APP_ORIGIN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
]
const paymentTtlSeconds = 15 * 60
const workflowTtlSeconds = 400 * 24 * 60 * 60
const rateLimits = {
  '/api/payments/start': 20,
  '/api/payments/finish': 20,
  workflowStart: 10,
  workflowFinish: 20,
  workflowCharge: 10,
  status: 120,
}
const paymentKey = (state) => `monsso:checkout:${state}`
const finishLockKey = (state) => `monsso:checkout-finish:${state}`
const workflowKey = (id) => `monsso:workflow:${id}`
const workflowChargeLockKey = (id) => `monsso:workflow-charge:${id}`

let clientPromise
let redisClient

function missingConfiguration() {
  return requiredEnvironment.filter((name) => !process.env[name])
}

function getRedis() {
  redisClient ??= Redis.fromEnv()
  return redisClient
}

function createPaymentStore(redis) {
  return {
    get: (state) => redis.get(paymentKey(state)),
    set: (state, payment, options = {}) => redis.set(
      paymentKey(state),
      payment,
      { ex: options.ex ?? paymentTtlSeconds },
    ),
    claimFinish: async (state, ttlSeconds) => (
      await redis.set(finishLockKey(state), '1', { ex: ttlSeconds, nx: true })
    ) === 'OK',
    releaseFinish: (state) => redis.del(finishLockKey(state)),
  }
}

function createWorkflowStore(redis) {
  return {
    get: (id) => redis.get(workflowKey(id)),
    set: (id, workflow, options = {}) => redis.set(
      workflowKey(id),
      workflow,
      { ex: options.ex ?? workflowTtlSeconds },
    ),
    claimCharge: async (id, ttlSeconds) => (
      await redis.set(workflowChargeLockKey(id), '1', { ex: ttlSeconds, nx: true })
    ) === 'OK',
    releaseCharge: (id) => redis.del(workflowChargeLockKey(id)),
  }
}

async function enforceRateLimit(request, route, redis) {
  const isStatus = /^\/api\/payments\/[0-9a-f-]{36}$/i.test(route) ||
    /^\/api\/automation\/(?:recurring|split)\/[0-9a-f-]{36}$/i.test(route)
  const isWorkflowStart = /^\/api\/automation\/(?:recurring|split)\/start$/.test(route)
  const isWorkflowFinish = /^\/api\/automation\/(?:recurring|split)\/finish$/.test(route)
  const isWorkflowCharge = /^\/api\/automation\/recurring\/[0-9a-f-]{36}\/charge$/i.test(route)
  const limit = isStatus
    ? rateLimits.status
    : isWorkflowStart
      ? rateLimits.workflowStart
      : isWorkflowFinish
        ? rateLimits.workflowFinish
        : isWorkflowCharge
          ? rateLimits.workflowCharge
          : rateLimits[route]
  if (!limit) return

  const forwardedFor = request.headers['x-forwarded-for']
  const address = Array.isArray(forwardedFor)
    ? forwardedFor.at(-1)
    : forwardedFor?.split(',').at(-1)
  const addressHash = createHash('sha256')
    .update(address?.trim() || 'unknown')
    .digest('hex')
    .slice(0, 24)
  const bucket = Math.floor(Date.now() / 60_000)
  const scope = isStatus
    ? 'status'
    : isWorkflowStart
      ? 'workflow-start'
      : isWorkflowFinish
        ? 'workflow-finish'
        : isWorkflowCharge
          ? 'workflow-charge'
          : route.slice('/api/payments/'.length)
  const key = `monsso:rate:${scope}:${addressHash}:${bucket}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 60)
  if (count > limit) {
    throw new PaymentError('Too many requests. Wait a minute and try again.', 429)
  }
}

async function getService() {
  const missing = missingConfiguration()
  if (missing.length) {
    throw new PaymentError(`Configure ${missing.join(', ')} in Vercel Environment Variables.`, 503)
  }

  if (
    !isTestnetWalletAddress(process.env.OP_CLIENT_WALLET_ADDRESS) ||
    !isTestnetWalletAddress(process.env.OP_MERCHANT_WALLET_ADDRESS)
  ) {
    throw new PaymentError('Configure HTTPS wallet addresses on the Interledger test network.', 400)
  }

  let appOrigin
  try {
    const configuredOrigin = new URL(process.env.MONSSO_APP_ORIGIN)
    if (
      configuredOrigin.protocol !== 'https:' ||
      configuredOrigin.origin !== process.env.MONSSO_APP_ORIGIN
    ) {
      throw new Error('MONSSO_APP_ORIGIN must be an HTTPS origin without a trailing slash or path.')
    }
    appOrigin = configuredOrigin.origin
  } catch {
    throw new PaymentError('Configure MONSSO_APP_ORIGIN as the public HTTPS site origin.', 503)
  }

  if (!clientPromise) {
    clientPromise = createAuthenticatedClient({
      walletAddressUrl: process.env.OP_CLIENT_WALLET_ADDRESS,
      privateKey: process.env.OP_PRIVATE_KEY,
      keyId: process.env.OP_KEY_ID,
    }).catch((error) => {
      clientPromise = undefined
      throw error
    })
  }

  const [client, redis] = await Promise.all([clientPromise, getRedis()])

  const serviceOptions = {
    client,
    merchantWalletAddress: process.env.OP_MERCHANT_WALLET_ADDRESS,
    appOrigin,
    payments: createPaymentStore(redis),
  }
  return {
    ...createOpenPaymentsService(serviceOptions),
    ...createOpenPaymentsWorkflowService({
      ...serviceOptions,
      workflows: createWorkflowStore(redis),
    }),
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new PaymentError('Send a JSON request body.', 415)
  }

  if (request.body !== undefined) {
    const bodySize = Buffer.byteLength(
      typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body),
    )
    if (bodySize > 8192) throw new PaymentError('Request body is too large.', 413)

    if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
      if (Array.isArray(request.body)) {
        throw new PaymentError('Request body must be a JSON object.')
      }
      return request.body
    }

    try {
      const parsed = JSON.parse(Buffer.isBuffer(request.body)
        ? request.body.toString('utf8')
        : request.body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected a JSON object.')
      }
      return parsed
    } catch {
      throw new PaymentError('Request body must contain a valid JSON object.')
    }
  }

  const chunks = []
  let totalBytes = 0

  for await (const chunk of request) {
    totalBytes += chunk.length
    if (totalBytes > 8192) throw new PaymentError('Request body is too large.', 413)
    chunks.push(chunk)
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a JSON object.')
    }
    return parsed
  } catch {
    throw new PaymentError('Request body must contain a valid JSON object.')
  }
}

export async function handleVercelApi(request, response, route) {
  if (request.method === 'GET' && route === '/api/health') {
    const missing = missingConfiguration()
    sendJson(response, 200, { configured: missing.length === 0, missing })
    return
  }

  if (route.startsWith('/api/auth/')) {
    await handleAuthApi(request, response, route)
    return
  }

  try {
    if (route.startsWith('/api/automation/')) {
      const user = getAuthenticatedUser(request)
      if (!user) {
        sendJson(response, 401, { error: 'Sign in to Monsso before using payment workflows.' })
        return
      }

      const body = request.method === 'POST' ? await readJsonBody(request) : {}
      const service = await getService()
      await enforceRateLimit(request, route, getRedis())

      if (request.method === 'POST' && route === '/api/automation/recurring/start') {
        sendJson(response, 201, await service.startRecurring({ ...body, ownerEmail: user.email }))
        return
      }
      if (request.method === 'POST' && route === '/api/automation/recurring/finish') {
        sendJson(response, 200, await service.finishRecurring({ ...body, ownerEmail: user.email }))
        return
      }
      if (request.method === 'POST' && route === '/api/automation/split/start') {
        sendJson(response, 201, await service.startSplit({ ...body, ownerEmail: user.email }))
        return
      }
      if (request.method === 'POST' && route === '/api/automation/split/finish') {
        sendJson(response, 200, await service.finishSplit({ ...body, ownerEmail: user.email }))
        return
      }

      const charge = /^\/api\/automation\/recurring\/([0-9a-f-]{36})\/charge$/i.exec(route)
      if (request.method === 'POST' && charge) {
        sendJson(response, 200, await service.chargeRecurring({
          ...body,
          id: charge[1],
          ownerEmail: user.email,
        }))
        return
      }

      const recurring = /^\/api\/automation\/recurring\/([0-9a-f-]{36})$/i.exec(route)
      if (request.method === 'GET' && recurring) {
        sendJson(response, 200, await service.getRecurring(recurring[1], user.email))
        return
      }

      const split = /^\/api\/automation\/split\/([0-9a-f-]{36})$/i.exec(route)
      if (request.method === 'GET' && split) {
        sendJson(response, 200, await service.getSplitStatus(split[1], user.email))
        return
      }

      sendJson(response, 404, { error: 'API route not found.' })
      return
    }

    if (request.method === 'POST' && route === '/api/payments/start') {
      const body = await readJsonBody(request)
      const service = await getService()
      await enforceRateLimit(request, route, getRedis())
      sendJson(response, 201, await service.startCheckout(body))
      return
    }

    if (request.method === 'POST' && route === '/api/payments/finish') {
      const body = await readJsonBody(request)
      const service = await getService()
      await enforceRateLimit(request, route, getRedis())
      sendJson(response, 200, await service.finishCheckout(body))
      return
    }

    const paymentStatus = /^\/api\/payments\/([0-9a-f-]{36})$/i.exec(route)
    if (request.method === 'GET' && paymentStatus) {
      const service = await getService()
      await enforceRateLimit(request, route, getRedis())
      sendJson(response, 200, await service.getCheckoutStatus(paymentStatus[1]))
      return
    }

    sendJson(response, 404, { error: 'API route not found.' })
  } catch (error) {
    const knownError = error instanceof PaymentError || error instanceof AuthError
    const statusCode = knownError ? error.statusCode : 502
    const message = knownError
      ? error.message
      : 'Open Payments test request failed. Check the Vercel function logs and wallet setup.'

    if (!knownError) {
      console.error('[api] Open Payments request failed:', error instanceof Error ? error.message : error)
    }

    sendJson(response, statusCode, { error: message })
  }
}
