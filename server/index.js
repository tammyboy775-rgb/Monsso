import { createServer } from 'node:http'
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
  'OP_KEY_ID',
]
const appOrigin = process.env.MONSSO_APP_ORIGIN ?? 'http://localhost:5173'
const port = 3001
const payments = new Map()
const workflowPlans = new Map()
const activeWorkflowCharges = new Set()
let clientPromise

function missingConfiguration() {
  const missing = requiredEnvironment.filter((name) => !process.env[name])
  if (!process.env.OP_PRIVATE_KEY && !process.env.OP_PRIVATE_KEY_PATH) {
    missing.push('OP_PRIVATE_KEY or OP_PRIVATE_KEY_PATH')
  }
  return missing
}

async function getService() {
  const missing = missingConfiguration()
  if (missing.length) {
    throw new PaymentError(`Configure ${missing.join(', ')} in .env to use the test checkout.`, 503)
  }

  if (
    !isTestnetWalletAddress(process.env.OP_CLIENT_WALLET_ADDRESS) ||
    !isTestnetWalletAddress(process.env.OP_MERCHANT_WALLET_ADDRESS)
  ) {
    throw new PaymentError('Configure HTTPS wallet addresses on the Interledger test network.', 400)
  }

  if (!clientPromise) {
    clientPromise = createAuthenticatedClient({
      walletAddressUrl: process.env.OP_CLIENT_WALLET_ADDRESS,
      privateKey: process.env.OP_PRIVATE_KEY || process.env.OP_PRIVATE_KEY_PATH,
      keyId: process.env.OP_KEY_ID,
    }).catch((error) => {
      clientPromise = undefined
      throw error
    })
  }

  const client = await clientPromise

  const serviceOptions = {
    client,
    merchantWalletAddress: process.env.OP_MERCHANT_WALLET_ADDRESS,
    appOrigin,
    payments,
  }
  const recurringPlans = {
    get: (id) => workflowPlans.get(id),
    set: async (id, value) => workflowPlans.set(id, structuredClone(value)),
    claimCharge: async (id) => {
      if (activeWorkflowCharges.has(id)) return false
      activeWorkflowCharges.add(id)
      return true
    },
    releaseCharge: async (id) => activeWorkflowCharges.delete(id),
  }

  return {
    ...createOpenPaymentsService(serviceOptions),
    ...createOpenPaymentsWorkflowService({ ...serviceOptions, workflows: recurringPlans }),
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

function sendApiError(response, error) {
  const knownError = error instanceof PaymentError || error instanceof AuthError
  const statusCode = knownError ? error.statusCode : 502
  const message = knownError
    ? error.message
    : 'Open Payments test request failed. Check the API server logs and wallet setup.'
  if (!knownError) {
    console.error('[api] Open Payments request failed:', error instanceof Error ? error.message : error)
  }
  sendJson(response, statusCode, { error: message })
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new PaymentError('Send a JSON request body.', 415)
  }

  const chunks = []
  let totalBytes = 0

  for await (const chunk of request) {
    totalBytes += chunk.length
    if (totalBytes > 8192) throw new PaymentError('Request body is too large.', 413)
    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new PaymentError('Request body must contain valid JSON.')
  }
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost')

  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    const missing = missingConfiguration()
    sendJson(response, 200, { configured: missing.length === 0, missing })
    return
  }

  if (requestUrl.pathname.startsWith('/api/auth/')) {
    await handleAuthApi(request, response, requestUrl.pathname)
    return
  }

  if (requestUrl.pathname.startsWith('/api/automation/')) {
    try {
      const user = getAuthenticatedUser(request)
      if (!user) {
        sendJson(response, 401, { error: 'Sign in to Monsso before using payment workflows.' })
        return
      }

      const service = await getService()
      const route = requestUrl.pathname
      if (request.method === 'POST' && route === '/api/automation/recurring/start') {
        const body = await readJsonBody(request)
        sendJson(response, 201, await service.startRecurring({ ...body, ownerEmail: user.email }))
        return
      }
      if (request.method === 'POST' && route === '/api/automation/recurring/finish') {
        const body = await readJsonBody(request)
        sendJson(response, 200, await service.finishRecurring({ ...body, ownerEmail: user.email }))
        return
      }
      if (request.method === 'POST' && route === '/api/automation/split/start') {
        const body = await readJsonBody(request)
        sendJson(response, 201, await service.startSplit({ ...body, ownerEmail: user.email }))
        return
      }
      if (request.method === 'POST' && route === '/api/automation/split/finish') {
        const body = await readJsonBody(request)
        sendJson(response, 200, await service.finishSplit({ ...body, ownerEmail: user.email }))
        return
      }

      const charge = /^\/api\/automation\/recurring\/([0-9a-f-]{36})\/charge$/i.exec(route)
      if (request.method === 'POST' && charge) {
        const body = await readJsonBody(request)
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
    } catch (error) {
      sendApiError(response, error)
    }
    return
  }

  try {
    if (request.method === 'POST' && requestUrl.pathname === '/api/payments/start') {
      const body = await readJsonBody(request)
      const service = await getService()
      sendJson(response, 201, await service.startCheckout(body))
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/payments/finish') {
      const body = await readJsonBody(request)
      const service = await getService()
      sendJson(response, 200, await service.finishCheckout(body))
      return
    }

    const paymentStatus = /^\/api\/payments\/([0-9a-f-]{36})$/i.exec(requestUrl.pathname)
    if (request.method === 'GET' && paymentStatus) {
      const service = await getService()
      sendJson(response, 200, await service.getCheckoutStatus(paymentStatus[1]))
      return
    }

    sendJson(response, 404, { error: 'API route not found.' })
  } catch (error) {
    sendApiError(response, error)
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[api] Monsso test API listening at http://127.0.0.1:${port}`)
})
