'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, Mail, AlertCircle, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface InboxEmail {
  id: string
  subject: string | null
  from_email: string | null
  received_at: string
  reply_sent: boolean
}

interface Derived {
  pending:      InboxEmail[]
  overdue:      InboxEmail[]
  todayCount:   number
}

function derive(emails: InboxEmail[]): Derived {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const todayStr = new Date().toISOString().slice(0, 10)

  const unreplied = emails.filter(e => !e.reply_sent)
  const overdue   = unreplied.filter(e => new Date(e.received_at) < cutoff)
  const pending   = unreplied.filter(e => new Date(e.received_at) >= cutoff)
  const todayCount = emails.filter(e => e.received_at?.startsWith(todayStr)).length

  return { pending, overdue, todayCount }
}

export function NotificationBell() {
  const [derived, setDerived] = useState<Derived>({ pending: [], overdue: [], todayCount: 0 })
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchInbox()
    const interval = setInterval(fetchInbox, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function fetchInbox() {
    try {
      const res  = await fetch('/api/personal/inbox?actionable=true&limit=50')
      if (!res.ok) return
      const json = await res.json()
      setDerived(derive(json.emails ?? []))
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (derived.overdue.length === 0) return
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Overdue emails need your attention', {
        body: `You have ${derived.overdue.length} overdue email${derived.overdue.length > 1 ? 's' : ''} waiting for reply`,
        icon: '/favicon.ico',
      })
    }
  }, [derived.overdue.length])

  const totalCount = derived.pending.length + derived.overdue.length

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen(v => !v)
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission()
          }
        }}
        className="relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {totalCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl shadow-slate-900/10 dark:shadow-slate-900/40 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Notifications
            </p>
            <div className="flex items-center gap-2">
              {derived.overdue.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                  {derived.overdue.length} overdue
                </span>
              )}
              {derived.todayCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                  {derived.todayCount} today
                </span>
              )}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <div className="p-4 text-center text-sm text-slate-400">Loading...</div>
            )}

            {!loading && totalCount === 0 && (
              <div className="p-6 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center mx-auto mb-2">
                  <Mail className="w-5 h-5 text-emerald-500" />
                </div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">All caught up!</p>
                <p className="text-xs text-slate-400 mt-1">No pending replies</p>
              </div>
            )}

            {derived.overdue.length > 0 && (
              <div>
                <p className="px-4 py-2 text-[11px] font-semibold text-red-500 uppercase tracking-wide bg-red-50 dark:bg-red-900/10">
                  Overdue
                </p>
                {derived.overdue.slice(0, 5).map(email => (
                  <div key={email.id}
                    className="px-4 py-3 border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 line-clamp-1">
                          {email.subject || '(No subject)'}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {derived.pending.length > 0 && (
              <div>
                <p className="px-4 py-2 text-[11px] font-semibold text-amber-600 uppercase tracking-wide bg-amber-50 dark:bg-amber-900/10">
                  Pending Reply
                </p>
                {derived.pending.slice(0, 5).map(email => (
                  <div key={email.id}
                    className="px-4 py-3 border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 line-clamp-1">
                          {email.subject || '(No subject)'}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {totalCount > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800">
              <a
                href="/"
                onClick={() => setOpen(false)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                View all pending emails →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
