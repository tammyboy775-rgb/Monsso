import { handleVercelApi } from '../../../server/vercel-api.js'

export default function handler(request, response) {
  const id = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id
  return handleVercelApi(request, response, `/api/automation/recurring/${id ?? ''}`)
}
