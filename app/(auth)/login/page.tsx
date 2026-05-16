'use client'

import { Suspense } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Zap, Mail, CheckCircle, BrainCircuit, ShieldCheck } from 'lucide-react'

const features = [
  { icon: Mail,         text: 'Connects to your inbox via secure OAuth 2.0' },
  { icon: BrainCircuit, text: 'AI automatically extracts action items from every email' },
  { icon: CheckCircle,  text: 'Never miss a follow-up or important task again' },
  { icon: ShieldCheck,  text: 'Your email content is never stored in plain text' },
]

function LoginContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  useEffect(() => {
    if (session) router.push('/')
  }, [session, router])

  if (status === 'loading') return (
    <div className="min-h-screen bg-[oklch(0.06_0.03_260)] flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-[oklch(0.06_0.03_260)] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-48 -left-48 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute -bottom-48 -right-48 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[100px] animate-pulse animate-delay-400" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-blue-500/5 rounded-full blur-[120px]" />
        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(oklch(1_0_0/3%)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/3%)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex items-center gap-3.5 mb-8 justify-center animate-slide-up">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/30 animate-float">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-white text-2xl font-bold tracking-tight">AI Email Agent</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 text-xs font-medium">Intelligent inbox management</span>
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white/[0.04] backdrop-blur-xl rounded-3xl border border-white/10 p-8 shadow-2xl shadow-black/40 animate-slide-up animate-delay-75">
          <h2 className="text-white text-2xl font-bold mb-2 tracking-tight">Get started free</h2>
          <p className="text-slate-400 text-sm mb-8 leading-relaxed">
            Connect your inbox to automatically extract tasks — no manual effort required.
          </p>

          <div className="space-y-4 mb-8">
            {features.map(({ icon: Icon, text }, i) => (
              <div
                key={text}
                className="flex items-start gap-3.5 animate-slide-in-left"
                style={{ animationDelay: `${150 + i * 80}ms` }}
              >
                <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-blue-400" />
                </div>
                <p className="text-slate-300 text-sm leading-relaxed pt-1">{text}</p>
              </div>
            ))}
          </div>

          {error === 'unauthorized' && (
            <div className="text-sm text-red-400 text-center mb-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              Access denied. Only registered team members with a{' '}
              {process.env.NEXT_PUBLIC_ORG_DOMAIN
                ? <span className="font-medium">@{process.env.NEXT_PUBLIC_ORG_DOMAIN}</span>
                : 'company'}{' '}
              account can sign in.
            </div>
          )}

          <Button
            className="w-full bg-white hover:bg-slate-50 text-slate-900 font-semibold h-12 text-sm rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98]"
            onClick={() => signIn('google', { callbackUrl: '/' })}
          >
            <svg className="w-4.5 h-4.5 mr-2.5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </Button>

          <p className="text-center text-xs text-slate-600 mt-4">
            Requires Gmail read access · Your data is never shared
          </p>
        </div>

        <p className="text-center text-xs text-slate-700 mt-6 animate-fade-in animate-delay-400">
          © 2025 AI Email Agent
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[oklch(0.06_0.03_260)] flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
