import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { createClient } from '@supabase/supabase-js'
import { TeamRole } from '@/lib/roles'

export { getServerSession, authOptions }

export function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const supabase = getServiceSupabase()
  const { data: user } = await supabase
    .from('users')
    .select('id, email, name, plan')
    .eq('email', session.user.email)
    .single()

  return user as { id: string; email: string; name: string | null; plan: string } | null
}

export interface AuthenticatedMember {
  id: string
  email: string
  name: string
  role: TeamRole
  is_active: boolean
  consent_given: boolean
}

export async function getMemberFromSession(): Promise<AuthenticatedMember | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const supabase = getServiceSupabase()
  const { data: member } = await supabase
    .from('team_members')
    .select('id, email, name, role, is_active, consent_given')
    .eq('email', session.user.email)
    .eq('is_active', true)
    .single()

  return member as AuthenticatedMember | null
}

/** Returns member only if consent has been given. Use in KB/agent routes. */
export async function getConsentedMember(): Promise<AuthenticatedMember | null> {
  const member = await getMemberFromSession()
  if (!member || !member.consent_given) return null
  return member
}
