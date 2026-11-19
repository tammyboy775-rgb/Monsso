import { createServer } from 'node:http'
import { createAuthenticatedClient } from '@interledger/open-payments'
import { handleAuthApi } from './auth.js'
import {
  createOpenPaymentsService,
  isTestnetWalletAddress,
  PaymentError,
} from './payments.js'

const requiredEnvironment = [
  'OP_CLIENT_WALLET_ADDRESS',
  'OP_MERCHANT_WALLET_ADDRESS',
  'OP_KEY_ID',
]
const appOrigin = process.env.MONSSO_APP_ORIGIN ?? 'http://localhost:5173'
const port = 3001
const payments = new Map()
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

  return createOpenPaymentsService({
    client,
    merchantWalletAddress: process.env.OP_MERCHANT_WALLET_ADDRESS,
    appOrigin,
    payments,
  })
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
    const statusCode = error instanceof PaymentError ? error.statusCode : 502
    const message = error instanceof PaymentError
      ? error.message
      : 'Open Payments test request failed. Check the API server logs and wallet setup.'

    if (!(error instanceof PaymentError)) {
      console.error('[api] Open Payments request failed:', error instanceof Error ? error.message : error)
    }

    sendJson(response, statusCode, { error: message })
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[api] Monsso test API listening at http://127.0.0.1:${port}`)
})
