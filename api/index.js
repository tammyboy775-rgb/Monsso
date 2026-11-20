import { handleVercelApi } from '../server/vercel-api.js'

export function getApiRoute(request) {
  const path = request.query?.route
  const apiPath = Array.isArray(path) ? path.join('/') : path
  return typeof apiPath === 'string' && apiPath
    ? `/api/${apiPath}`
    : '/api'
}

export default function handler(request, response) {
  return handleVercelApi(request, response, getApiRoute(request))
}
