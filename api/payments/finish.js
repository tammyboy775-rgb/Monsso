import { handleVercelApi } from '../../server/vercel-api.js'

export default function handler(request, response) {
  return handleVercelApi(request, response, '/api/payments/finish')
}
