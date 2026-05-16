'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle, Mail, RefreshCw, AlertCircle, AlertTriangle,
  Zap, ShieldCheck,
} from 'lucide-react'

export default function SettingsPage() {
  const { data: session } = useSession()
  const [watchStatus, setWatchStatus] = useState<'loading' | 'idle' | 'setting-up' | 'success' | 'error' | 'expired'>('loading')
  const [watchExpiry, setWatchExpiry] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/gmail/setup')
      .then(r => r.json())
      .then(data => {
        if (data.watch_expiry) {
          const expiry = new Date(data.watch_expiry)
          setWatchExpiry(data.watch_expiry)
          setWatchStatus(expiry > new Date() ? 'success' : 'expired')
        } else {
          setWatchStatus('idle')
        }
      })
      .catch(() => setWatchStatus('idle'))
  }, [])

  const setupGmailWatch = async () => {
    setWatchStatus('setting-up')
    try {
      const res = await fetch('/api/gmail/setup', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setWatchExpiry(data.expiry)
        setWatchStatus('success')
      } else {
        setWatchStatus('error')
      }
    } catch {
      setWatchStatus('error')
    }
  }

  const steps = [
    'Registers a watch on your INBOX',
    'Google delivers push notifications to our webhook for new emails',
    'AI automatically extracts and categorizes action items in real-time',
  ]

  return (
    <>
      <Header title="Settings" subtitle="Manage your connection and preferences" />
      <div className="p-6 max-w-2xl space-y-5">

        {/* Connected Accounts */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-slide-up">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
              <Mail className="w-4.5 h-4.5 text-red-500" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-800 dark:text-slate-100">Connected Accounts</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Inbox accounts used for monitoring</p>
            </div>
          </div>
          <div className="px-5 py-5">
            {session?.user?.email ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-red-400 to-red-500 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm shadow-red-200 dark:shadow-red-900/30">
                    {session.user.name?.[0]?.toUpperCase() ?? 'G'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{session.user.email}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Google account</p>
                  </div>
                </div>
                {(watchStatus === 'loading' || watchStatus === 'setting-up') && (
                  <Badge className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 text-xs font-semibold px-3 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mr-1.5 inline-block" />
                    Checking…
                  </Badge>
                )}
                {watchStatus === 'success' && (
                  <Badge className="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 text-xs font-semibold px-3 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 inline-block animate-pulse" />
                    Connected
                  </Badge>
                )}
                {watchStatus === 'expired' && (
                  <Badge className="bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 text-xs font-semibold px-3 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 inline-block" />
                    Expired
                  </Badge>
                )}
                {(watchStatus === 'idle' || watchStatus === 'error') && (
                  <Badge className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 text-xs font-semibold px-3 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mr-1.5 inline-block" />
                    Not Connected
                  </Badge>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No accounts connected.</p>
            )}
          </div>
        </div>

        {/* Gmail Webhook Watch */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-slide-up" style={{ animationDelay: '70ms' }}>
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
              <Zap className="w-4.5 h-4.5 text-blue-500" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-800 dark:text-slate-100">Real-time Monitoring</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Register a push webhook for instant processing</p>
            </div>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800 p-4">
              <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">How it works</p>
              <div className="space-y-3">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            {watchStatus === 'success' && (
              <div className="flex items-center gap-2.5 text-emerald-700 dark:text-emerald-400 text-sm bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl px-4 py-3 animate-fade-in">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>Watch active{watchExpiry ? ` · expires ${new Date(watchExpiry).toLocaleDateString()}` : ''}</span>
              </div>
            )}

            {watchStatus === 'error' && (
              <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3 animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Setup failed. Check your webhook configuration.</span>
              </div>
            )}

            {watchStatus === 'expired' && (
              <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 animate-fade-in">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Gmail watch expired on {new Date(watchExpiry!).toLocaleDateString()}.
                  Click &quot;Activate Email Watch&quot; to reconnect.
                </span>
              </div>
            )}

            <Button
              onClick={setupGmailWatch}
              disabled={watchStatus === 'setting-up'}
              className="bg-blue-600 hover:bg-blue-700 text-white h-10 px-5 text-sm font-semibold rounded-xl transition-all duration-200 hover:shadow-md hover:shadow-blue-500/20"
            >
              {watchStatus === 'setting-up' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Setting up…
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 mr-2" />
                  Activate Email Watch
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Privacy notice */}
        <div className="flex items-start gap-3 px-5 py-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 animate-slide-up" style={{ animationDelay: '140ms' }}>
          <div className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4.5 h-4.5 text-slate-400 dark:text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-0.5">Privacy</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
              Your email content is only used for task extraction and is never stored in plain text beyond the AI-generated summary.
            </p>
          </div>
        </div>

      </div>
    </>
  )
}
