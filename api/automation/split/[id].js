import { handleVercelApi } from '../../../server/vercel-api.js'

export function getSplitStatusRoute(request) {
  const id = Array.isArray(request.query?.id) ? request.query.id[0] : request.query?.id
  return `/api/automation/split/${id ?? ''}`
}

export default function handler(request, response) {
  return handleVercelApi(request, response, getSplitStatusRoute(request))
}
