'use client'

import { useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Zap, CheckCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const CONSENT_POINTS = [
  {
    id: 'gmail',
    text: 'Gmail inbox will be read via Google OAuth — no password is stored, only a revocable access token.',
  },
  {
    id: 'summaries',
    text: 'Work emails are summarised by AI. Raw email content is never persisted to our database — only the summary is stored.',
  },
  {
    id: 'team',
    text: 'Summaries are shared with authorised team members according to your role hierarchy in the organisation.',
  },
  {
    id: 'personal',
    text: 'Personal emails are kept strictly private and are permanently deleted after 10 days of ingestion.',
  },
  {
    id: 'audit',
    text: 'All knowledge-base queries are audit-logged for compliance and security review purposes.',
  },
  {
    id: 'block',
    text: 'Personal topics (health, finance, legal, family) are always blocked from team-wide queries — even for managers.',
  },
] as const

export default function ConsentPage() {
  const { data: session } = useSession()
  const router = useRouter()

  const [agreed, setAgreed]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const firstName = session?.user?.name?.split(' ')[0] ?? 'there'

  async function handleAccept() {
    if (!agreed || loading) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/consent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accepted: true }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`)
      }

      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[oklch(0.06_0.03_260)] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-48 -left-48 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[100px]" />
        <div className="absolute -bottom-48 -right-48 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[100px]" />
        <div className="absolute inset-0 bg-[linear-gradient(oklch(1_0_0/3%)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/3%)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <div className="w-full max-w-lg relative z-10">
        {/* Logo row */}
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/30">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <p className="text-white text-xl font-bold tracking-tight">AI Email Agent</p>
        </div>

        <Card className="bg-white/[0.04] backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/40 rounded-3xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-2xl font-bold tracking-tight">
              Before you continue, {firstName}
            </CardTitle>
            <p className="text-slate-400 text-sm leading-relaxed mt-1">
              AI Email Agent connects to your Gmail to extract action items, summarise
              communications, and surface project intelligence for your team. Please read
              the following carefully before granting access.
            </p>
          </CardHeader>

          <CardContent className="space-y-5">
            <Separator className="bg-white/10" />

            {/* Scrollable consent list */}
            <div className="max-h-72 overflow-y-auto pr-1 space-y-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
              {CONSENT_POINTS.map((point) => (
                <div key={point.id} className="flex items-start gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-slate-300 text-sm leading-relaxed">{point.text}</p>
                </div>
              ))}
            </div>

            <Separator className="bg-white/10" />

            {/* Agree checkbox */}
            <label className="flex items-start gap-3 cursor-pointer group select-none">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="sr-only peer"
                />
                <div className={cn(
                  'w-5 h-5 rounded-md border-2 transition-all duration-200 flex items-center justify-center',
                  agreed
                    ? 'bg-blue-500 border-blue-500'
                    : 'bg-white/5 border-white/20 group-hover:border-white/40',
                )}>
                  {agreed && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-slate-300 text-sm leading-relaxed">
                I have read and agree to the data processing terms above.
              </span>
            </label>

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-3 pt-1">
              <Button
                className={cn(
                  'w-full h-12 font-semibold rounded-xl text-sm transition-all duration-200',
                  agreed && !loading
                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/25 active:scale-[0.98]'
                    : 'bg-white/10 text-white/30 cursor-not-allowed',
                )}
                disabled={!agreed || loading}
                onClick={handleAccept}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Saving your consent…
                  </span>
                ) : (
                  'Accept & Continue'
                )}
              </Button>

              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors py-1"
              >
                Sign out
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-700 mt-5">
          © 2025 AI Email Agent · Data processing consent v1.0
        </p>
      </div>
    </div>
  )
}
