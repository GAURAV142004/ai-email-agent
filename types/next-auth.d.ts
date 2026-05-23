import { TeamRole } from '@/lib/roles'
import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    accessToken?: string
    refreshToken?: string
    user: {
      memberId: string
      role: TeamRole
      consentGiven: boolean
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    refreshToken?: string
    googleId?: string
    role?: string
    memberName?: string
    memberId?: string
    consentGiven?: boolean
  }
}
