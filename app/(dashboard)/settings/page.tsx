'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import {
  Mail, RefreshCw, AlertCircle, AlertTriangle, CheckCircle2,
  Settings2, Shield, Clock, Database, Zap,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { TeamRole } from '@/lib/roles'

// ── Section card wrapper ────────────────────────────────────────────────────────
function SectionCard({
  icon: Icon,
  iconClass,
  title,
  subtitle,
  children,
  delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  title: string
  subtitle: string
  children: React.ReactNode
  delay?: number
}) {
  return (
    <div
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconClass}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  )
}

// ── Status pill ────────────────────────────────────────────────────────────────
function StatusPill({
  status,
}: {
  status: 'active' | 'expired' | 'none' | 'loading'
}) {
  const map = {
    active: {
      cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30',
      dot: 'bg-emerald-500 animate-pulse',
      label: 'Active',
    },
    expired: {
      cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
      dot: 'bg-amber-500',
      label: 'Expired',
    },
    none: {
      cls: 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700',
      dot: 'bg-slate-400',
      label: 'Not connected',
    },
    loading: {
      cls: 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700',
      dot: 'bg-slate-300',
      label: 'Checking…',
    },
  }
  const s = map[status]
  return (
    <Badge
      className={`border text-xs font-semibold px-3 py-1 rounded-full ${s.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${s.dot}`} />
      {s.label}
    </Badge>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { data: session } = useSession()
  const role = (session?.user as any)?.role as TeamRole | undefined
  const isDeliveryLead = role === 'delivery_lead'

  // Gmail watch state
  type WatchStatus = 'loading' | 'active' | 'expired' | 'none' | 'setting-up' | 'error'
  const [watchStatus, setWatchStatus] = useState<WatchStatus>('loading')
  const [watchExpiry, setWatchExpiry] = useState<string | null>(null)
  const [watchMsg, setWatchMsg] = useState<string | null>(null)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<string | null>(null)

  // KB sync state
  const [kbSyncing, setKbSyncing] = useState(false)
  const [kbMsg, setKbMsg] = useState<string | null>(null)
  const [lastKbSync, setLastKbSync] = useState<string | null>(null)

  // Consent state
  const [consentAt, setConsentAt] = useState<string | null>(null)

  // Load Gmail watch status
  useEffect(() => {
    fetch('/api/gmail/setup')
      .then((r) => r.json())
      .then((data) => {
        if (data.watch_expiry) {
          setWatchExpiry(data.watch_expiry)
          const expired = new Date(data.watch_expiry) < new Date()
          setWatchStatus(expired ? 'expired' : 'active')
        } else {
          setWatchStatus('none')
        }
        if (data.last_sync) setLastSync(data.last_sync)
      })
      .catch(() => setWatchStatus('none'))
  }, [])

  // Load member stats (KB sync time + consent)
  useEffect(() => {
    fetch('/api/me/stats')
      .then((r) => r.json())
      .then((data) => {
        if (data.last_kb_sync) setLastKbSync(data.last_kb_sync)
        if (data.consent_at) setConsentAt(data.consent_at)
      })
      .catch(() => {})
  }, [])

  async function handleActivateWatch() {
    setWatchStatus('setting-up')
    setWatchMsg(null)
    try {
      const res = await fetch('/api/gmail/setup', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setWatchExpiry(data.expiry ?? null)
        setWatchStatus('active')
        setWatchMsg('Gmail watch activated successfully.')
      } else {
        setWatchStatus('error')
        setWatchMsg(data.error ?? 'Failed to activate Gmail watch.')
      }
    } catch {
      setWatchStatus('error')
      setWatchMsg('Network error. Please try again.')
    }
  }

  async function handleSyncNow() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/gmail/sync', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        const n = data.synced ?? data.emails_synced ?? 0
        setSyncMsg(`Synced ${n} email${n !== 1 ? 's' : ''}.`)
        setLastSync(new Date().toISOString())
      } else {
        setSyncMsg(data.error ?? 'Sync failed.')
      }
    } catch {
      setSyncMsg('Sync failed — network error.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleKbSync(bootstrap = false) {
    setKbSyncing(true)
    setKbMsg(null)
    try {
      const url = bootstrap
        ? '/api/admin/trigger-kb-sync?bootstrap=true&days=30'
        : '/api/admin/trigger-kb-sync'
      const res  = await fetch(url, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        const kb  = data.totalKBEntriesAdded ?? 0
        const pi  = data.totalPersonalAdded  ?? 0
        const tot = data.totalEmailsProcessed ?? 0
        setKbMsg(
          bootstrap
            ? `Bootstrap done — ${tot} emails scanned, ${kb} added to KB, ${pi} to inbox.`
            : `Sync done — ${kb} KB entries added, ${pi} inbox emails.`,
        )
        setLastKbSync(new Date().toISOString())
      } else {
        setKbMsg(data.error ?? 'KB sync failed.')
      }
    } catch {
      setKbMsg('Network error.')
    } finally {
      setKbSyncing(false)
    }
  }

  const watchStatusPill: 'loading' | 'active' | 'expired' | 'none' =
    watchStatus === 'setting-up' || watchStatus === 'error' ? 'none'
    : watchStatus === 'loading' ? 'loading'
    : watchStatus

  return (
    <>
      <Header title="Settings" subtitle="Manage connection and preferences" />
      <div className="p-6 max-w-2xl space-y-5">

        {/* ── Section 1: Gmail Connection ──────────────────────────────────── */}
        <SectionCard
          icon={Mail}
          iconClass="bg-red-50 dark:bg-red-500/10 text-red-500"
          title="Gmail Connection"
          subtitle="Email watch and sync settings"
          delay={0}
        >
          {/* Account row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-400 to-red-500 flex items-center justify-center text-white text-sm font-bold shadow-sm">
                {session?.user?.name?.[0]?.toUpperCase() ?? 'G'}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {session?.user?.email ?? '—'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Google account</p>
              </div>
            </div>
            <StatusPill status={watchStatusPill} />
          </div>

          {/* Expiry info */}
          {watchExpiry && watchStatus === 'active' && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Watch active · expires {new Date(watchExpiry).toLocaleDateString()}
            </div>
          )}
          {watchExpiry && watchStatus === 'expired' && (
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Watch expired on {new Date(watchExpiry).toLocaleDateString()}. Re-activate below.
            </div>
          )}
          {watchStatus === 'error' && (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {watchMsg ?? 'Setup failed. Check your webhook configuration.'}
            </div>
          )}
          {watchStatus === 'active' && watchMsg && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {watchMsg}
            </div>
          )}

          <Separator />

          {/* Buttons row */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handleActivateWatch}
              disabled={watchStatus === 'setting-up'}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm h-9"
            >
              {watchStatus === 'setting-up' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Activating…
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  Activate Email Watch
                </>
              )}
            </Button>

            <Button
              onClick={handleSyncNow}
              disabled={syncing}
              variant="outline"
              className="gap-2 rounded-xl text-sm h-9 border-slate-200 dark:border-slate-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync Now'}
            </Button>
          </div>

          {/* Sync feedback */}
          {syncMsg && (
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              {syncMsg}
            </p>
          )}
          {lastSync && (
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Last synced: {new Date(lastSync).toLocaleString()}
            </p>
          )}
        </SectionCard>

        {/* ── Section 2: Knowledge Base Sync ──────────────────────────────── */}
        <SectionCard
          icon={Database}
          iconClass="bg-violet-50 dark:bg-violet-500/10 text-violet-500"
          title="Knowledge Base Sync"
          subtitle="Controls how emails are indexed into the project KB"
          delay={70}
        >
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            The knowledge base syncs automatically every{' '}
            <strong className="text-slate-800 dark:text-slate-200">4 hours</strong>. Each sync
            processes newly received project-related emails, generates summaries, and updates vector
            embeddings used by the Agent.
          </p>

          {lastKbSync && (
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Last KB sync: {new Date(lastKbSync).toLocaleString()}
            </p>
          )}

          {kbMsg && (
            <p
              className={`text-xs flex items-center gap-1.5 ${
                kbMsg.toLowerCase().includes('fail') || kbMsg.toLowerCase().includes('error')
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {kbMsg}
            </p>
          )}

          {isDeliveryLead && (
            <>
              <Separator />
              <div className="space-y-3">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Admin — Manual Controls
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => handleKbSync(false)}
                    disabled={kbSyncing}
                    variant="outline"
                    className="gap-2 rounded-xl text-sm h-9 border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${kbSyncing ? 'animate-spin' : ''}`} />
                    {kbSyncing ? 'Syncing…' : 'Sync New Emails'}
                  </Button>
                  <Button
                    onClick={() => handleKbSync(true)}
                    disabled={kbSyncing}
                    className="gap-2 rounded-xl text-sm h-9 bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    <Database className="w-3.5 h-3.5" />
                    {kbSyncing ? 'Running…' : 'Bootstrap Last 30 Days'}
                  </Button>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <strong className="text-slate-500 dark:text-slate-400">Sync New Emails</strong> — processes emails received since last sync.<br />
                  <strong className="text-slate-500 dark:text-slate-400">Bootstrap Last 30 Days</strong> — use this first time to populate the KB with recent emails.
                </p>
              </div>
            </>
          )}
        </SectionCard>

        {/* ── Section 3: Data & Privacy ─────────────────────────────────────── */}
        <SectionCard
          icon={Shield}
          iconClass="bg-slate-50 dark:bg-slate-800 text-slate-500"
          title="Data & Privacy"
          subtitle="Retention policy and consent information"
          delay={140}
        >
          {/* Retention */}
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
            <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Personal email retention
              </p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Personal inbox emails are automatically deleted after{' '}
                <strong className="text-slate-600 dark:text-slate-300">10 days</strong>. Project
                knowledge base entries are retained indefinitely.
              </p>
            </div>
          </div>

          {/* Consent */}
          <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Consent given
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
                {consentAt
                  ? `You gave consent on ${new Date(consentAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}.`
                  : 'Your consent is recorded in our system.'}
              </p>
            </div>
          </div>

          {/* Policy link */}
          <p className="text-xs text-slate-400 leading-relaxed">
            Read the full{' '}
            <a
              href="/consent"
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              data consent policy
            </a>{' '}
            to understand how your email data is processed, what is stored, and your rights to
            request deletion.
          </p>
        </SectionCard>

      </div>
    </>
  )
}
