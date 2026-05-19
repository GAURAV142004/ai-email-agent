import NextAuth, { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { createClient } from '@supabase/supabase-js'
import { TeamRole } from '@/lib/roles'
import { encryptToken } from '@/lib/crypto'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify',
          ].join(' '),
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile, trigger, session: s }) {
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.googleId = (profile as any)?.sub
      }
      if (trigger === 'signIn' || trigger === 'update' || !token.memberName || !token.role) {
        const supabase = getServiceClient()
        const { data: member } = await supabase
          .from('team_members')
          .select('id, role, name')
          .eq('email', token.email ?? '')
          .single()
        if (member) {
          token.role       = member.role
          token.memberName = member.name
          token.memberId   = member.id
        }
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken  = token.accessToken
      session.refreshToken = token.refreshToken
      if (session.user) {
        if (token.memberName) session.user.name     = token.memberName as string
        if (token.role)       session.user.role     = token.role as TeamRole
        if (token.memberId)   session.user.memberId = token.memberId as string
      }
      return session
    },
    async redirect({ url, baseUrl }) {
      // Always land on the dashboard root after sign-in
      if (url.startsWith(baseUrl)) return baseUrl
      if (url.startsWith('/')) return `${baseUrl}${url}`
      return baseUrl
    },
    async signIn({ user, account, profile }) {
      // Rule 1: Google only
      if (account?.provider !== 'google') return false

      // Rule 2: org domain check
      const orgDomain = process.env.ORG_DOMAIN
      if (orgDomain && !profile?.email?.endsWith(`@${orgDomain}`)) {
        return '/login?error=unauthorized'
      }

      // Rule 3: must be a pre-registered active team member
      const supabase = getServiceClient()
      const { data: member } = await supabase
        .from('team_members')
        .select('id, role, is_active')
        .eq('email', profile?.email ?? '')
        .single()

      if (!member || !member.is_active) {
        return '/login?error=unauthorized'
      }

      // Existing: upsert user row + connected_accounts
      if (!user.email) return false

      try {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .upsert({ email: user.email, name: user.name }, { onConflict: 'email' })
          .select('id')
          .single()

        if (userError || !userData) {
          console.error('Failed to upsert user:', userError)
          return false
        }

        if (account?.provider === 'google' && account.access_token) {
          await supabase.from('connected_accounts').upsert(
            {
              user_id: (userData as any).id,
              provider: 'gmail',
              email: user.email,
              access_token: encryptToken(account.access_token),
              refresh_token: account.refresh_token ? encryptToken(account.refresh_token) : null,
              status: 'active',
            },
            { onConflict: 'user_id, email' }
          )

          // Also persist tokens to member_gmail_tokens for the reply feature
          if (member?.id) {
            await supabase.from('member_gmail_tokens').upsert(
              {
                member_id:     member.id,
                access_token:  encryptToken(account.access_token),
                refresh_token: encryptToken(account.refresh_token ?? ''),
                expires_at:    account.expires_at
                  ? new Date(account.expires_at * 1000).toISOString()
                  : null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'member_id' }
            )
          }

          // Update team_members.supabase_uid so inbox status
          // reflects correctly in Manage Users page
          await supabase
            .from('team_members')
            .update({ supabase_uid: String(userData.id) })
            .eq('email', user.email)
            .is('supabase_uid', null)  // only set once — never overwrite
        }

        return true
      } catch (err) {
        console.error('Sign-in callback error:', err)
        return false
      }
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
