'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { PersonalEmailCard } from '@/components/dashboard/PersonalEmailCard'
import { DailyTodos } from '@/components/dashboard/DailyTodos'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate } from '@/lib/utils'
import type {
  PersonalInboxEmail,
  DailyTodo,
  PersonalEmailStats,
  TodoPriority,
} from '@/lib/supabase/types'
import {
  Mail, MailOpen, Zap, CheckSquare, Search,
  RefreshCw, Send, Loader2, X, Reply,
  AlertCircle, CheckCheck,
} from 'lucide-react'

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label:   string
  value:   number | string
  icon:    React.ComponentType<{ className?: string }>
  color:   'blue' | 'violet' | 'amber' | 'emerald'
  loading: boolean
}

const COLOR_MAP = {
  blue:    { bar: 'bg-blue-500',    icon: 'bg-blue-50 dark:bg-blue-950/40 text-blue-500',    val: 'text-blue-600 dark:text-blue-400' },
  violet:  { bar: 'bg-violet-500',  icon: 'bg-violet-50 dark:bg-violet-950/40 text-violet-500', val: 'text-violet-600 dark:text-violet-400' },
  amber:   { bar: 'bg-amber-500',   icon: 'bg-amber-50 dark:bg-amber-950/40 text-amber-500',   val: 'text-amber-600 dark:text-amber-400' },
  emerald: { bar: 'bg-emerald-500', icon: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500', val: 'text-emerald-600 dark:text-emerald-400' },
}

function StatCard({ label, value, icon: Icon, color, loading }: StatCardProps) {
  const c = COLOR_MAP[color]
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 flex items-center gap-4">
      <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center shrink-0', c.icon)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{label}</p>
        {loading
          ? <div className="h-8 w-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          : <p className={cn('text-3xl font-bold leading-none', c.val)}>{value}</p>
        }
      </div>
      {/* accent bar */}
      <div className={cn('absolute bottom-0 left-0 right-0 h-[3px]', c.bar)} />
    </div>
  )
}

// ── Reply modal ───────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'from-blue-500 to-blue-600', 'from-violet-500 to-violet-600',
  'from-rose-500 to-rose-600',  'from-amber-500 to-amber-600',
  'from-emerald-500 to-emerald-600', 'from-cyan-500 to-cyan-600',
]

function getAvatarGradient(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    const p = name.trim().split(' ').filter(Boolean)
    return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
  }
  return (email ?? '?').slice(0, 2).toUpperCase()
}

interface ReplyModalProps {
  email:   PersonalInboxEmail | null
  onClose: () => void
  onSent:  () => void
}

function ReplyModal({ email, onClose, onSent }: ReplyModalProps) {
  const [body,    setBody]    = useState('')
  const [sending, setSending] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [sent,    setSent]    = useState(false)

  useEffect(() => {
    if (!email) { setBody(''); setError(null); setSent(false) }
  }, [email])

  async function handleSend() {
    if (!email || !body.trim() || sending) return
    setSending(true)
    setError(null)

    try {
      const res = await fetch('/api/gmail/reply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          personalEmailId: email.id,
          toEmail:         email.from_email ?? '',
          subject:         email.subject ? `Re: ${email.subject}` : 'Re: (No subject)',
          bodyHtml:        body.trim().replace(/\n/g, '<br>'),
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)

      setSent(true)
      setTimeout(() => { onSent() }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply')
      setSending(false)
    }
  }

  if (!email) return null

  const initials = getInitials(email.from_name, email.from_email)
  const gradient = getAvatarGradient(email.from_name ?? email.from_email ?? 'x')
  const sender   = email.from_name || email.from_email || 'Unknown sender'

  return (
    <Dialog open={!!email} onOpenChange={(open) => { if (!open && !sending) onClose() }}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden dark:bg-slate-900 dark:border-slate-700 rounded-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
              <Reply className="w-4.5 h-4.5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-white">Reply</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">via Gmail</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sender card */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 bg-gradient-to-br shadow-sm', gradient)}>
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{sender}</p>
              {email.from_name && email.from_email && (
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{email.from_email}</p>
              )}
            </div>
          </div>
        </div>

        {/* To / Subject fields */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 space-y-2">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-400 dark:text-slate-500 font-medium w-14 shrink-0">To</span>
            <span className="text-slate-700 dark:text-slate-300 truncate">
              {email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-400 dark:text-slate-500 font-medium w-14 shrink-0">Subject</span>
            <span className="text-slate-700 dark:text-slate-300 truncate font-medium">
              {email.subject ? `Re: ${email.subject}` : 'Re: (No subject)'}
            </span>
          </div>
        </div>

        {/* Compose area */}
        <div className="px-6 py-4">
          {sent ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
                <CheckCheck className="w-7 h-7 text-emerald-500" />
              </div>
              <p className="text-sm font-semibold text-slate-800 dark:text-white">Reply sent!</p>
              <p className="text-xs text-slate-400">Closing…</p>
            </div>
          ) : (
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`Write your reply to ${sender}…`}
              rows={8}
              disabled={sending}
              className="resize-none text-sm bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 dark:focus:border-blue-600 transition-all"
            />
          )}

          {/* Original email snippet */}
          {email.snippet && !sent && (
            <div className="mt-3 px-3 py-2.5 border-l-2 border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 rounded-r-lg">
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mb-1">
                Original · {formatDate(email.received_at)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-500 leading-relaxed line-clamp-3">
                {email.snippet}
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {!sent && (
          <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20">
            <Button
              onClick={handleSend}
              disabled={!body.trim() || sending}
              className="gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold px-6 rounded-xl"
            >
              {sending ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Sending…</>
              ) : (
                <><Send className="w-4 h-4" />Send Reply</>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={sending}
              className="px-5 rounded-xl dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <p className="text-[11px] text-slate-400 ml-auto">Sent via Gmail API</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function PersonalDashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [emails,        setEmails]        = useState<PersonalInboxEmail[]>([])
  const [emailStats,    setEmailStats]    = useState<PersonalEmailStats | null>(null)
  const [emailLoading,  setEmailLoading]  = useState(true)

  const [todos,         setTodos]         = useState<DailyTodo[]>([])
  const [todosLoading,  setTodosLoading]  = useState(true)

  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [searchQuery,    setSearchQuery]    = useState('')
  const [replyEmail,     setReplyEmail]     = useState<PersonalInboxEmail | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchEmails = useCallback(async () => {
    setEmailLoading(true)
    try {
      const params = new URLSearchParams({ limit: '40' })
      if (showUnreadOnly)           params.set('unread', 'true')
      if (priorityFilter !== 'all') params.set('priority', priorityFilter)
      const res = await fetch(`/api/personal/inbox?${params}`)
      if (res.ok) {
        const data = await res.json()
        setEmails(data.emails ?? [])
        setEmailStats(data.stats ?? null)
      }
    } finally {
      setEmailLoading(false)
    }
  }, [showUnreadOnly, priorityFilter])

  const fetchTodos = useCallback(async () => {
    setTodosLoading(true)
    try {
      const res = await fetch('/api/personal/todos?date=today')
      if (res.ok) {
        const data = await res.json()
        setTodos(data.todos ?? [])
      }
    } finally {
      setTodosLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) { fetchEmails(); fetchTodos() }
  }, [session, fetchEmails, fetchTodos])

  // ── Supabase Realtime ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.user?.email) return
    const supabase = createClient()
    const channel  = supabase
      .channel('personal-inbox-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'personal_inbox_emails' }, (payload) => {
        setEmails((prev) => [payload.new as PersonalInboxEmail, ...prev])
        setEmailStats((prev) => prev ? { ...prev, total: prev.total + 1, unread: prev.unread + (payload.new.is_read ? 0 : 1) } : prev)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'personal_inbox_emails' }, (payload) => {
        setEmails((prev) => prev.map((e) => e.id === payload.new.id ? { ...e, ...(payload.new as PersonalInboxEmail) } : e))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session])

  // ── Email actions ───────────────────────────────────────────────────────────
  const handleMarkRead = useCallback(async (id: string) => {
    const res = await fetch(`/api/personal/inbox/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_read: true }),
    })
    if (res.ok) {
      setEmails((prev) => prev.map((e) => e.id === id ? { ...e, is_read: true } : e))
      setEmailStats((prev) => prev && prev.unread > 0 ? { ...prev, unread: prev.unread - 1 } : prev)
    }
  }, [])

  const handleDismiss = useCallback(async (id: string) => {
    // Use DELETE — PATCH does not support dismissed field
    await fetch(`/api/personal/inbox/${id}`, { method: 'DELETE' })
    setEmails((prev) => prev.filter((e) => e.id !== id))
    setEmailStats((prev) => prev && prev.total > 0 ? { ...prev, total: prev.total - 1 } : prev)
  }, [])

  // ── Todo actions ────────────────────────────────────────────────────────────
  const handleTodoUpdate = useCallback(async (id: string, patch: Partial<Pick<DailyTodo, 'status' | 'title' | 'priority'>>) => {
    const res = await fetch(`/api/personal/todos/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    if (res.ok) setTodos((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t))
  }, [])

  const handleTodoDelete = useCallback(async (id: string) => {
    await fetch(`/api/personal/todos/${id}`, { method: 'DELETE' })
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleTodoAdd = useCallback(async (data: { title: string; priority: TodoPriority; linked_email_id?: string }) => {
    const res = await fetch('/api/personal/todos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })
    if (res.ok) {
      const json = await res.json()
      setTodos((prev) => [json.todo, ...prev])
    }
  }, [])

  // ── Filtered emails ─────────────────────────────────────────────────────────
  const visibleEmails = emails.filter((e) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return [e.subject ?? '', e.from_name ?? '', e.from_email ?? '', e.snippet ?? ''].join(' ').toLowerCase().includes(q)
  })

  const todosDueToday = todos.filter((t) => t.status !== 'completed' && t.status !== 'deferred').length

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (status === 'loading' || !session) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[5, 4].map((count, col) => (
            <div key={col} className="space-y-2">
              {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const greeting = session.user?.name?.split(' ')[0] ?? 'there'

  return (
    <>
      <Header title="Dashboard" subtitle={`Good day, ${greeting}`} />

      <div className="p-6 space-y-6">

        {/* ── Stat cards ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total Emails"     value={emailStats?.total ?? 0}       icon={Mail}        color="blue"    loading={emailLoading} />
          <StatCard label="Unread"           value={emailStats?.unread ?? 0}      icon={MailOpen}    color="violet"  loading={emailLoading} />
          <StatCard label="Actionable"       value={emailStats?.actionable ?? 0}  icon={Zap}         color="amber"   loading={emailLoading} />
          <StatCard label="Todos Due Today"  value={todosDueToday}                icon={CheckSquare} color="emerald" loading={todosLoading} />
        </div>

        {/* ── Two-column layout ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 items-start">

          {/* ── Personal inbox ─────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            {/* Column header */}
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Personal Inbox</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {emailLoading ? 'Loading…' : `${visibleEmails.length} email${visibleEmails.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <button
                onClick={fetchEmails}
                disabled={emailLoading}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', emailLoading && 'animate-spin')} />
              </button>
            </div>

            {/* Filters */}
            <div className="px-5 py-2.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2 bg-slate-50/50 dark:bg-slate-800/20">
              <div className="relative flex-1 min-w-[120px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full pl-8 pr-3 h-8 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 dark:focus:border-blue-600 transition-all"
                />
              </div>
              <button
                onClick={() => setShowUnreadOnly((v) => !v)}
                className={cn(
                  'h-8 px-3 text-xs rounded-lg border font-medium transition-colors',
                  showUnreadOnly
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                Unread only
              </button>
              <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v ?? 'all')}>
                <SelectTrigger className="w-[130px] h-8 text-xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 dark:text-slate-300 rounded-lg">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All priorities</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Email list */}
            <div className="divide-y divide-slate-50 dark:divide-slate-800/50 overflow-y-auto max-h-[620px]">
              {emailLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-[72px] bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
                  ))}
                </div>
              ) : visibleEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                    <Mail className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">No emails found</p>
                  <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">
                    {showUnreadOnly || priorityFilter !== 'all' || searchQuery
                      ? 'Try adjusting your filters'
                      : 'Your inbox is empty'}
                  </p>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {visibleEmails.map((email) => (
                    <PersonalEmailCard
                      key={email.id}
                      email={email}
                      onMarkRead={handleMarkRead}
                      onReply={setReplyEmail}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Daily To-Do ────────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Today&apos;s To-Do</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                {todosLoading ? 'Loading…' : `${todosDueToday} task${todosDueToday !== 1 ? 's' : ''} pending`}
              </p>
            </div>
            <div className="p-4">
              {todosLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
                  ))}
                </div>
              ) : (
                <DailyTodos
                  todos={todos}
                  emails={emails}
                  onUpdate={handleTodoUpdate}
                  onDelete={handleTodoDelete}
                  onAdd={handleTodoAdd}
                />
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Reply modal ──────────────────────────────────────────────────────── */}
      <ReplyModal
        email={replyEmail}
        onClose={() => setReplyEmail(null)}
        onSent={() => { setReplyEmail(null); fetchEmails() }}
      />
    </>
  )
}
