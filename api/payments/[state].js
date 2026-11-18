import { handleVercelApi } from '../../server/vercel-api.js'

export default function handler(request, response) {
  const state = Array.isArray(request.query?.state)
    ? request.query.state[0]
    : request.query?.state

  return handleVercelApi(request, response, `/api/payments/${state ?? ''}`)
}
