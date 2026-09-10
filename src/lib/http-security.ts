import { timingSafeEqual } from 'node:crypto'

export function independentlyAuthenticatedPath(pathname: string): boolean {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return normalized === '/api/health' || normalized === '/api/webhooks/github'
}

export function hasValidBasicAuthorization(
  request: Request,
  username: string,
  password: string,
): boolean {
  const actual = request.headers.get('authorization') ?? ''
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  )
}

export function withSecurityHeaders(
  response: Response,
  request: Request,
): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'same-origin')
  headers.set(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  )
  if (
    new URL(request.url).protocol === 'https:' ||
    request.headers.get('x-forwarded-proto') === 'https'
  ) {
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    )
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
