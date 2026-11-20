import { handleVercelApi } from '../server/vercel-api.js'

export function getApiRoute(request) {
  return new URL(request.url, 'https://monsso.invalid').pathname
}

export default function handler(request, response) {
  return handleVercelApi(request, response, getApiRoute(request))
}
