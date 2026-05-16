import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  })

  const role = (token as any)?.role as string | undefined
  const path = request.nextUrl.pathname

  // Unauthenticated: redirect page requests to /login
  // API routes handle their own auth (webhook + cron use separate secrets)
  if (!token && !path.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Monitor — delivery_lead only
  if (path.startsWith('/monitor') && role && role !== 'delivery_lead') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Manage Users — manager roles only
  const CAN_MANAGE_USERS = ['delivery_lead', 'senior_ba', 'senior_mis', 'senior_developer']
  if (path.startsWith('/settings/users') && role && !CAN_MANAGE_USERS.includes(role)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Team View — seniors + delivery_lead only
  const teamRoles = ['delivery_lead', 'senior_ba', 'senior_mis', 'senior_developer']
  if (path.startsWith('/team') && role && !teamRoles.includes(role)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)'],
}
