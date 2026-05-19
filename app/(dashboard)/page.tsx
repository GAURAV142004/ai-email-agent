'use client'

import { useEffect, useState, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { DailyDigest } from '@/components/dashboard/DailyDigest'
import { TaskTable } from '@/components/dashboard/TaskTable'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import type { Task, TaskStatus, ThreadWithMember } from '@/lib/supabase/types'
import { Copy, RefreshCw, Search, Sparkles, CheckCircle, Clock, BarChart2, AlertCircle, Hourglass } from 'lucide-react'
import { GmailSearchPanel } from '@/components/dashboard/GmailSearchPanel'
import { TaskDetailPanel } from '@/components/dashboard/TaskDetailPanel'
import { ReplyComposer } from '@/components/dashboard/ReplyComposer'
import { cn } from '@/lib/utils'

interface MyStats {
  avg_response_minutes: number | null
  on_time_pct: number | null
  pending_count: number
  awaiting_reply_count: number
}

interface ThisWeek {
  appReplies: number
  gmailReplies: number
  avgThisWeek: number | null
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function MyResponseStats() {
  const [stats,    setStats]    = useState<MyStats | null>(null)
  const [thisWeek, setThisWeek] = useState<ThisWeek | null>(null)

  useEffect(() => {
    fetch('/api/me/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setStats(d.stats)
          setThisWeek(d.thisWeek)
        }
      })
      .catch(() => {})
  }, [])

  const chips = [
    {
      label:  'Avg Response',
      value:  stats?.avg_response_minutes != null ? formatDuration(stats.avg_response_minutes) : '—',
      icon:   Clock,
      color:  stats?.avg_response_minutes == null ? 'text-slate-400'
              : stats.avg_response_minutes < 120   ? 'text-emerald-600 dark:text-emerald-400'
              : stats.avg_response_minutes < 480   ? 'text-yellow-600 dark:text-yellow-500'
              : 'text-red-600 dark:text-red-400',
    },
    {
      label:  'On Time Rate',
      value:  stats?.on_time_pct != null ? `${Math.round(stats.on_time_pct)}%` : '—',
      icon:   BarChart2,
      color:  stats?.on_time_pct == null ? 'text-slate-400'
              : stats.on_time_pct >= 80  ? 'text-emerald-600 dark:text-emerald-400'
              : stats.on_time_pct >= 50  ? 'text-yellow-600 dark:text-yellow-500'
              : 'text-red-600 dark:text-red-400',
    },
    {
      label:  'Pending',
      value:  stats?.pending_count ?? '—',
      icon:   AlertCircle,
      color:  (stats?.pending_count ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300',
    },
    {
      label:  'Awaiting Reply',
      value:  stats?.awaiting_reply_count ?? '—',
      icon:   Hourglass,
      color:  (stats?.awaiting_reply_count ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300',
    },
  ]

  return (
    <div className="mb-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 border-t-[3px] border-t-blue-500 p-5 shadow-sm animate-slide-up">
      <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">
        My Response Stats
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {chips.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            </div>
            <div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-none mb-0.5">{label}</p>
              <p className={cn('text-base font-bold leading-none', color)}>{value}</p>
            </div>
          </div>
        ))}
      </div>
      {thisWeek && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-3 mt-1">
          This week: <span className="text-slate-600 dark:text-slate-300 font-medium">{thisWeek.appReplies} via app</span>
          {' · '}
          <span className="text-slate-600 dark:text-slate-300 font-medium">{thisWeek.gmailReplies} via Gmail</span>
          {thisWeek.avgThisWeek != null && (
            <> · avg {formatDuration(thisWeek.avgThisWeek)}</>
          )}
        </p>
      )}
    </div>
  )
}

function DigestSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 border-t-[3px] border-t-slate-200 dark:border-t-slate-700 p-5 shadow-sm animate-fade-in"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="h-2.5 skeleton rounded w-16" />
            <div className="w-8 h-8 skeleton rounded-xl" />
          </div>
          <div className="h-9 skeleton rounded w-12" />
        </div>
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [followUpTask, setFollowUpTask] = useState<Task | null>(null)
  const [followUpDraft, setFollowUpDraft] = useState<{ subject: string; body: string } | null>(null)
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [replyThread, setReplyThread] = useState<ThreadWithMember | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [searchReplyThread, setSearchReplyThread] = useState<ThreadWithMember | null>(null)
  const [pendingThreads, setPendingThreads] = useState<any[]>([])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchPendingThreads = useCallback(async () => {
    const res  = await fetch('/api/threads?replyStatus=pending&limit=10')
    const data = await res.json()
    setPendingThreads(data.threads ?? [])
  }, [])

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (priorityFilter !== 'all') params.set('priority', priorityFilter)

    const res = await fetch(`/api/tasks?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      setTasks(data.tasks ?? [])
    }
    setLoading(false)
  }, [statusFilter, priorityFilter])

  const syncEmails = async () => {
    setSyncing(true)
    try {
      await fetch('/api/gmail/sync', { method: 'POST' })
      await fetchTasks()
    } finally {
      setSyncing(false)
    }
  }

  async function handleSearchReply(gmailThreadId: string, subject: string, from: string) {
    const supabase = createClient()
    const { data: thread } = await supabase
      .from('email_threads')
      .select(`*, owner:team_members!owner_member_id(id, name, email, role)`)
      .eq('thread_id', gmailThreadId)
      .single()

    if (thread) {
      const t = thread as any
      const shaped: ThreadWithMember = {
        ...t,
        owner_name:         t.owner?.name  ?? '',
        owner_email:        t.owner?.email ?? '',
        owner_role:         t.owner?.role  ?? '',
        owner_avatar_url:   null,
        task_count:         0,
        pending_task_count: 0,
        highest_priority:   'medium' as const,
      }
      setSearchReplyThread(shaped)
      setSearchOpen(false)
    } else {
      window.open(`https://mail.google.com/mail/u/0/#inbox/${gmailThreadId}`, '_blank')
    }
  }

  useEffect(() => {
    if (session) {
      fetchTasks()
      fetchPendingThreads()
    }
  }, [session, fetchTasks, fetchPendingThreads])

  useEffect(() => {
    if (!session?.user?.email) return
    const supabase = createClient()
    const channel = supabase
      .channel('tasks-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, (payload) => {
        setTasks(prev => [payload.new as Task, ...prev])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, (payload) => {
        setTasks(prev => prev.map(t =>
          t.id === payload.new.id ? { ...t, ...payload.new as Task } : t
        ))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session, fetchTasks])

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)))
  }

  const handleFollowUp = async (task: Task) => {
    setFollowUpTask(task)
    setFollowUpDraft(null)
    setGeneratingDraft(true)
    setCopied(false)

    const res = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'followup',
        subject: task.email_threads?.subject ?? '',
        threadContent: task.email_threads?.summary ?? task.task,
        taskDescription: task.task,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      setFollowUpDraft(data.draft)
    }
    setGeneratingDraft(false)
  }

  const handleCopy = () => {
    if (!followUpDraft) return
    navigator.clipboard.writeText(`Subject: ${followUpDraft.subject}\n\n${followUpDraft.body}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  if (status === 'loading' || !session) return (
    <div className="p-6 animate-fade-in">
      <div className="h-16 mb-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 -mx-6 -mt-6 px-6 flex items-center">
        <div className="h-5 skeleton rounded w-32" />
      </div>
      <DigestSkeleton />
      <div className="h-12 skeleton rounded-2xl mb-5" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-14 skeleton rounded-xl mb-2" style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  )

  const greeting = session.user?.name?.split(' ')[0] ?? 'there'

  return (
    <>
      <Header
        title="Dashboard"
        subtitle={`Welcome back, ${greeting}`}
      />
      <div className="p-6">
        {loading ? <DigestSkeleton /> : <DailyDigest tasks={tasks} />}

        <MyResponseStats />

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2.5 mb-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3 shadow-sm animate-slide-up">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
            <SelectTrigger className="w-38 h-8 text-sm border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors dark:text-slate-300">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="ignored">Ignored</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v ?? 'all')}>
            <SelectTrigger className="w-38 h-8 text-sm border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors dark:text-slate-300">
              <SelectValue placeholder="All priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priority</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 rounded-lg text-sm"
              onClick={fetchTasks}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-500/40 transition-all duration-200 px-3 rounded-lg text-sm"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="w-3.5 h-3.5 mr-1.5" />
              Search Inbox
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={syncEmails}
              disabled={syncing}
              className="h-8 gap-1.5 text-sm"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
              {syncing ? 'Syncing...' : 'Sync Inbox'}
            </Button>

            <span className="text-xs text-slate-400 dark:text-slate-500 pl-2.5 border-l border-slate-200 dark:border-slate-700">
              {loading ? '—' : `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
            </span>
          </div>
        </div>

        {pendingThreads.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Needs Reply
                <span className="text-xs font-normal px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full">
                  {pendingThreads.length}
                </span>
              </h2>
            </div>
            <div className="space-y-2">
              {pendingThreads.slice(0, 5).map(thread => (
                <div
                  key={thread.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer card-hover"
                >
                  <div className="w-8 h-8 rounded-full shrink-0 bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-bold">
                    {thread.from_email?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                      {thread.subject || '(No subject)'}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {thread.from_email} · {
                        thread.received_at
                          ? formatDistanceToNow(new Date(thread.received_at), { addSuffix: true })
                          : '—'
                      }
                    </p>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-full shrink-0">
                    Pending
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <div className={cn('min-w-[600px]', loading ? 'opacity-0 pointer-events-none' : 'animate-fade-in')}>
            <TaskTable
              tasks={tasks}
              onStatusChange={handleStatusChange}
              onFollowUp={handleFollowUp}
              onTaskClick={setSelectedTask}
            />
          </div>
        </div>
      </div>

      <TaskDetailPanel
        task={selectedTask}
        isOpen={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
        onTaskUpdated={(updated) => {
          setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
          setSelectedTask(updated)
        }}
        onReply={(thread) => setReplyThread(thread)}
      />

      {replyThread && (
        <ReplyComposer
          thread={replyThread}
          isOpen={replyThread !== null}
          onClose={() => setReplyThread(null)}
          onReplySent={() => { setReplyThread(null); fetchTasks() }}
        />
      )}

      <GmailSearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onReply={handleSearchReply}
      />

      {searchReplyThread && (
        <ReplyComposer
          thread={searchReplyThread}
          isOpen={searchReplyThread !== null}
          onClose={() => setSearchReplyThread(null)}
          onReplySent={() => { setSearchReplyThread(null); fetchTasks() }}
        />
      )}

      {/* Follow-up dialog */}
      <Dialog open={!!followUpTask} onOpenChange={() => { setFollowUpTask(null); setCopied(false) }}>
        <DialogContent className="max-w-lg dark:bg-slate-900 dark:border-slate-800">
          <DialogHeader>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-blue-500" />
              </div>
              <DialogTitle className="text-base font-bold dark:text-white">Draft Follow-up Reply</DialogTitle>
            </div>
            <DialogDescription className="text-sm leading-relaxed dark:text-slate-400">
              AI-generated reply for:{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">{followUpTask?.task}</span>
            </DialogDescription>
          </DialogHeader>

          {generatingDraft ? (
            <div className="py-12 flex flex-col items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-blue-500 animate-pulse" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Drafting your reply…</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">This usually takes a few seconds</p>
              </div>
            </div>
          ) : followUpDraft ? (
            <div className="space-y-3.5 animate-fade-in">
              <div>
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Subject</p>
                <p className="text-sm text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 font-medium">
                  {followUpDraft.subject}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Body</p>
                <pre className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 whitespace-pre-wrap font-sans leading-relaxed max-h-60 overflow-y-auto">
                  {followUpDraft.body}
                </pre>
              </div>
              <Button
                size="sm"
                className={`w-full h-10 text-sm font-semibold rounded-xl transition-all duration-200 ${
                  copied
                    ? 'bg-emerald-600 hover:bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                    : 'bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-slate-900'
                }`}
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 mr-2" />
                    Copied to clipboard!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-2" />
                    Copy to clipboard
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-400 dark:text-slate-500 text-sm">
              Could not generate draft. Please try again.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
