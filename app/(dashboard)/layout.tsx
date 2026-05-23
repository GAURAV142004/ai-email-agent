import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { DashboardShell } from '@/components/layout/DashboardShell'

/**
 * Server-side consent check.
 * Fetches /api/consent using the session cookie so the check runs on the
 * server before the dashboard is rendered.  If the member has not given
 * consent yet they are redirected to /consent.
 */
async function checkConsent(cookieHeader: string): Promise<boolean> {
  try {
    // Build an absolute URL — required for server-side fetch in Next.js
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      'http://localhost:3000'

    const res = await fetch(`${baseUrl}/api/consent`, {
      headers: {
        cookie: cookieHeader,
      },
      // Don't cache — always get the freshest consent status
      cache: 'no-store',
    })

    if (!res.ok) return false
    const data = await res.json()
    return data.consentGiven === true
  } catch {
    // If the check itself fails (e.g. during build) we allow through —
    // client-side guards will catch it.
    return true
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 1. Verify the user is authenticated
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    redirect('/login')
  }

  // 2. Check consent — forward the session cookie to the API route
  const cookieStore = await cookies()
  const cookieHeader = cookieStore
    .getAll()
    .map((c: { name: string; value: string }) => `${c.name}=${c.value}`)
    .join('; ')

  const hasConsent = await checkConsent(cookieHeader)
  if (!hasConsent) {
    redirect('/consent')
  }

  return <DashboardShell>{children}</DashboardShell>
}
