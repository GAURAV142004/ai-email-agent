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
  DialogHeader,
  DialogTitle,
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
import { Card, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type {
  PersonalInboxEmail,
  DailyTodo,
  PersonalEmailStats,
  TodoPriority,
} from '@/lib/supabase/types'
import {
  Mail,
  MailOpen,
  Zap,
  CheckSquare,
  Search,
  RefreshCw,
  Send,
  Loader2,
} from 'lucide-react'

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label:   string
  value:   number | string
  icon:    React.ComponentType<{ className?: string }>
  accent:  string
  loading: boolean
}

function StatCard({ label, value, icon: Icon, accent, loading }: StatCardProps) {
  return (
    <Card className={cn(
      'rounded-2xl border border-t-[3px] shadow-sm bg-white dark:bg-slate-900',
      'border-slate-200 dark:border-slate-800',
      accent,
    )}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
            {label}
          </p>
          <div className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
            <Icon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
          </div>
        </div>
        {loading ? (
          <div className="h-9 w-12 skeleton rounded" />
        ) : (
          <p className="text-3xl font-bold text-slate-900 dark:text-white">{value}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Reply modal ───────────────────────────────────────────────────────────────

interface ReplyModalProps {
  email:   PersonalInboxEmail | null
  onClose: () => void
  onSent:  () => void
}

function ReplyModal({ email, onClose, onSent }: ReplyModalProps) {
  const [body,    setBody]    = useState('')
  const [sending, setSending] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!email) {
      setBody('')
      setError(null)
    }
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
          thread_id:  email.gmail_thread_id,
          message_id: email.gmail_message_id,
          to:         email.from_email,
          subject:    email.subject ? `Re: ${email.subject}` : 'Re: (No subject)',
          body:       body.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)
      }

      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply')
      setSending(false)
    }
  }

  return (
    <Dialog open={!!email} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg dark:bg-slate-900 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-base font-bold flex items-center gap-2 dark:text-white">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
              <Send className="w-4 h-4 text-blue-500" />
            </div>
            Reply
          </DialogTitle>
          {email && (
            <div className="mt-2 space-y-0.5">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                {email.subject ?? '(No subject)'}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                To: {email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email}
              </p>
            </div>
          )}
        </DialogHeader>

        <div className="space-y-3 mt-1">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your reply…"
            rows={7}
            className="resize-none text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-500"
          />

          {error && (
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleSend}
              disabled={!body.trim() || sending}
              className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Reply
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              className="h-10 px-5 text-sm dark:border-slate-700 dark:text-slate-300"
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main dashboard page ───────────────────────────────────────────────────────

export default function PersonalDashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  // Emails
  const [emails,       setEmails]       = useState<PersonalInboxEmail[]>([])
  const [emailStats,   setEmailStats]   = useState<PersonalEmailStats | null>(null)
  const [emailLoading, setEmailLoading] = useState(true)

  // Todos
  const [todos,       setTodos]       = useState<DailyTodo[]>([])
  const [todosLoading, setTodosLoading] = useState(true)

  // Filters
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [searchQuery,    setSearchQuery]    = useState('')

  // Reply modal
  const [replyEmail, setReplyEmail] = useState<PersonalInboxEmail | null>(null)

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  // ── Fetch helpers ───────────────────────────────────────────────────────────
  const fetchEmails = useCallback(async () => {
    setEmailLoading(true)
    try {
      const params = new URLSearchParams({ limit: '40' })
      if (showUnreadOnly)           params.set('unread', 'true')
      if (priorityFilter !== 'all') params.set('priority', priorityFilter)

      const res  = await fetch(`/api/personal/inbox?${params.toString()}`)
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

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (session) {
      fetchEmails()
      fetchTodos()
    }
  }, [session, fetchEmails, fetchTodos])

  // ── Supabase Realtime — personal inbox ──────────────────────────────────────
  useEffect(() => {
    if (!session?.user?.email) return

    const supabase = createClient()
    const channel  = supabase
      .channel('personal-inbox-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'personal_inbox_emails' },
        (payload) => {
          setEmails((prev) => [payload.new as PersonalInboxEmail, ...prev])
          setEmailStats((prev) => prev
            ? { ...prev, total: prev.total + 1, unread: prev.unread + (payload.new.is_read ? 0 : 1) }
            : prev
          )
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'personal_inbox_emails' },
        (payload) => {
          setEmails((prev) =>
            prev.map((e) =>
              e.id === payload.new.id ? { ...e, ...(payload.new as PersonalInboxEmail) } : e,
            ),
          )
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [session])

  // ── Email actions ───────────────────────────────────────────────────────────
  const handleMarkRead = useCallback(async (id: string) => {
    const res = await fetch(`/api/personal/inbox/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_read: true }),
    })
    if (res.ok) {
      setEmails((prev) =>
        prev.map((e) => (e.id === id ? { ...e, is_read: true } : e)),
      )
      setEmailStats((prev) => prev && prev.unread > 0
        ? { ...prev, unread: prev.unread - 1 }
        : prev
      )
    }
  }, [])

  const handleDismiss = useCallback(async (id: string) => {
    await fetch(`/api/personal/inbox/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ dismissed: true }),
    })
    setEmails((prev) => prev.filter((e) => e.id !== id))
    setEmailStats((prev) => prev && prev.total > 0
      ? { ...prev, total: prev.total - 1 }
      : prev
    )
  }, [])

  // ── Todo actions ────────────────────────────────────────────────────────────
  const handleTodoUpdate = useCallback(async (
    id: string,
    patch: Partial<Pick<DailyTodo, 'status' | 'title' | 'priority'>>,
  ) => {
    const res = await fetch(`/api/personal/todos/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    })
    if (res.ok) {
      setTodos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      )
    }
  }, [])

  const handleTodoDelete = useCallback(async (id: string) => {
    await fetch(`/api/personal/todos/${id}`, { method: 'DELETE' })
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleTodoAdd = useCallback(async (data: {
    title:           string
    priority:        TodoPriority
    linked_email_id?: string
  }) => {
    const res = await fetch('/api/personal/todos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    })
    if (res.ok) {
      const json = await res.json()
      setTodos((prev) => [json.todo, ...prev])
    }
  }, [])

  // ── Filtered emails for display ─────────────────────────────────────────────
  const visibleEmails = emails.filter((e) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const haystack = [
        e.subject ?? '',
        e.from_name ?? '',
        e.from_email ?? '',
        e.snippet ?? '',
      ].join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  // ── Todos due today ─────────────────────────────────────────────────────────
  const todosDueToday = todos.filter(
    (t) => t.status !== 'completed' && t.status !== 'deferred',
  ).length

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (status === 'loading' || !session) {
    return (
      <div className="p-6 animate-fade-in">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 skeleton rounded-2xl" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 skeleton rounded-xl" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 skeleton rounded-xl" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const greeting = session.user?.name?.split(' ')[0] ?? 'there'

  return (
    <>
      <Header title="Dashboard" subtitle={`Welcome back, ${greeting}`} />

      <div className="p-6 space-y-6">

        {/* ── Stats bar ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Total Emails"
            value={emailStats?.total ?? 0}
            icon={Mail}
            accent="border-t-slate-400"
            loading={emailLoading}
          />
          <StatCard
            label="Unread"
            value={emailStats?.unread ?? 0}
            icon={MailOpen}
            accent="border-t-blue-500"
            loading={emailLoading}
          />
          <StatCard
            label="Actionable"
            value={emailStats?.actionable ?? 0}
            icon={Zap}
            accent="border-t-yellow-500"
            loading={emailLoading}
          />
          <StatCard
            label="Todos Due Today"
            value={todosDueToday}
            icon={CheckSquare}
            accent="border-t-green-500"
            loading={todosLoading}
          />
        </div>

        {/* ── Two-column layout ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* ── Left: Personal Inbox ──────────────────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            {/* Column header */}
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Personal Inbox</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {emailLoading ? 'Loading…' : `${visibleEmails.length} email${visibleEmails.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                onClick={fetchEmails}
                disabled={emailLoading}
              >
                <RefreshCw className={cn('w-3.5 h-3.5', emailLoading && 'animate-spin')} />
              </Button>
            </div>

            {/* Filters */}
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative flex-1 min-w-[120px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full pl-8 pr-3 h-8 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-blue-600"
                />
              </div>

              {/* Unread toggle */}
              <button
                onClick={() => setShowUnreadOnly((v) => !v)}
                className={cn(
                  'h-8 px-3 text-xs rounded-lg border font-medium transition-colors',
                  showUnreadOnly
                    ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800',
                )}
              >
                Unread
              </button>

              {/* Priority filter */}
              <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v ?? '')}>
                <SelectTrigger className="w-28 h-8 text-xs bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-slate-300">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All priority</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Email list */}
            <div className="divide-y divide-slate-50 dark:divide-slate-800/60 overflow-y-auto max-h-[600px]">
              {emailLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-20 skeleton rounded-xl" style={{ animationDelay: `${i * 40}ms` }} />
                  ))}
                </div>
              ) : visibleEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                    <Mail className="w-5 h-5 text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">No emails found</p>
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

          {/* ── Right: Daily To-Do ─────────────────────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Today&apos;s To-Do
              </p>
            </div>

            <div className="p-4">
              {todosLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-12 skeleton rounded-xl" style={{ animationDelay: `${i * 40}ms` }} />
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
        onSent={() => {
          setReplyEmail(null)
          fetchEmails()
        }}
      />
    </>
  )
}
