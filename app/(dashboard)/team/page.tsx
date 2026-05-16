'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { ChevronDown, ChevronRight, ExternalLink, MessageSquareReply } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { PriorityBadge } from '@/components/dashboard/PriorityBadge'
import { ResponseBadge } from '@/components/dashboard/ResponseBadge'
import { ReplyComposer } from '@/components/dashboard/ReplyComposer'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { hasTeam, type TeamRole, ROLE_LABELS, ROLE_COLORS } from '@/lib/roles'
import type { TeamMember, ThreadWithMember } from '@/lib/supabase/types'
import { ThreadTree } from '@/components/dashboard/ThreadTree'

// ─── inline helpers ───────────────────────────────────────────────────────────

function RoleTag({ role }: { role: string }) {
  const r = role as TeamRole
  const colors = ROLE_COLORS[r] ?? { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400' }
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
      {ROLE_LABELS[r] ?? role}
    </span>
  )
}

function MemberPill({
  member, selected, onClick,
}: { member: TeamMember; selected: boolean; onClick: () => void }) {
  const r = member.role as TeamRole
  const colors = ROLE_COLORS[r] ?? { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-300' }
  const initials = member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border whitespace-nowrap shrink-0',
          selected
            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border-slate-300 dark:border-slate-600 ring-2 ring-blue-500/30 shadow-sm'
            : 'bg-transparent text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-800 dark:hover:text-slate-200'
        )}
      >
        <span className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0', colors.bg, colors.text)}>
          {initials}
        </span>
        <span>{member.name.split(' ')[0]}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <p className="font-medium">{member.name}</p>
        <p className="text-slate-400">{ROLE_LABELS[r] ?? member.role}</p>
      </TooltipContent>
    </Tooltip>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const role = session?.user?.role as TeamRole | undefined

  const [members,          setMembers]          = useState<TeamMember[]>([])
  const [threads,          setThreads]          = useState<ThreadWithMember[]>([])
  const [loading,          setLoading]          = useState(true)
  const [loadingMore,      setLoadingMore]      = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [replyFilter,      setReplyFilter]      = useState('all')
  const [expandedId,       setExpandedId]       = useState<string | null>(null)
  const [total,            setTotal]            = useState(0)
  const [hasMore,          setHasMore]          = useState(false)
  const [replyThread,      setReplyThread]      = useState<ThreadWithMember | null>(null)

  // Guard: individual contributors cannot access team view
  useEffect(() => {
    if (session && role && !hasTeam(role)) router.replace('/')
  }, [session, role, router])

  // Fetch visible members once on mount
  useEffect(() => {
    if (!session) return
    fetch('/api/users')
      .then(r => r.json())
      .then(d => setMembers(d.members ?? []))
  }, [session])

  const fetchThreads = useCallback(async (currentOffset: number, append = false) => {
    if (!append) setLoading(true)
    const params = new URLSearchParams({ limit: '50', offset: String(currentOffset) })
    if (selectedMemberId) params.set('memberId', selectedMemberId)
    // "at_risk" maps to pending in the API — ResponseBadge differentiates visually
    const apiStatus = replyFilter === 'at_risk' ? 'pending' : replyFilter
    if (apiStatus !== 'all') params.set('replyStatus', apiStatus)

    const res = await fetch(`/api/threads?${params}`)
    if (res.ok) {
      const data = await res.json()
      setThreads(prev => append ? [...prev, ...data.threads] : data.threads)
      setTotal(data.total)
      setHasMore(data.hasMore)
    }
    if (!append) setLoading(false)
    setLoadingMore(false)
  }, [selectedMemberId, replyFilter])

  // Re-fetch whenever filters or session change
  useEffect(() => {
    if (session) fetchThreads(0, false)
  }, [session, fetchThreads])

  const loadMore = () => {
    setLoadingMore(true)
    fetchThreads(threads.length, true)
  }

  // ── loading / auth guard ────────────────────────────────────────────────────
  if (status === 'loading' || !session) return (
    <div className="p-6">
      <div className="h-10 skeleton rounded w-48 mb-6" />
      <div className="h-10 skeleton rounded-2xl mb-5" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 skeleton rounded-xl mb-2" style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  )

  return (
    <>
      <Header
        title="Team View"
        subtitle={`${members.length} member${members.length !== 1 ? 's' : ''}`}
      />

      <div className="p-6">
        {/* ── member filter pills ──────────────────────────────────────────── */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-5" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setSelectedMemberId(null)}
            className={cn(
              'flex items-center px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-150 border whitespace-nowrap shrink-0',
              selectedMemberId === null
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border-slate-300 dark:border-slate-600 ring-2 ring-blue-500/30 shadow-sm'
                : 'bg-transparent text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-800 dark:hover:text-slate-200'
            )}
          >
            All members
          </button>
          {members.map(m => (
            <MemberPill
              key={m.id}
              member={m}
              selected={selectedMemberId === m.id}
              onClick={() => setSelectedMemberId(prev => prev === m.id ? null : m.id)}
            />
          ))}
        </div>

        {/* ── toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-5">
          <Select value={replyFilter} onValueChange={(v) => setReplyFilter(v ?? 'all')}>
            <SelectTrigger className="w-44 h-8 text-sm border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-lg dark:text-slate-300">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="at_risk">At Risk</SelectItem>
              <SelectItem value="replied">Replied</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
            {loading ? '—' : `${total} thread${total !== 1 ? 's' : ''}`}
          </span>
        </div>

        {/* ── thread table ─────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          {/* Header row */}
          <div className="hidden lg:grid grid-cols-[minmax(140px,2fr)_minmax(120px,2fr)_minmax(180px,3fr)_120px_90px_140px_80px_40px] gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
            <span>Member</span>
            <span>From</span>
            <span>Subject</span>
            <span>Received</span>
            <span>Priority</span>
            <span>Reply</span>
            <span>Tasks</span>
            <span />
          </div>

          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 skeleton rounded-xl" style={{ animationDelay: `${i * 40}ms` }} />
              ))}
            </div>
          ) : threads.length === 0 ? (
            <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm">
              No emails found for the selected filters.
            </div>
          ) : (
            <div>
              {threads.map((thread, idx) => (
                <div
                  key={thread.id}
                  className={cn(
                    'border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors animate-fade-in',
                    expandedId === thread.id
                      ? 'bg-slate-50/60 dark:bg-slate-800/30'
                      : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/20'
                  )}
                  style={{ animationDelay: `${idx * 20}ms` }}
                >
                  {/* Data row */}
                  <div
                    className="grid grid-cols-[minmax(140px,2fr)_minmax(120px,2fr)_minmax(180px,3fr)_120px_90px_140px_80px_40px] gap-3 px-5 py-3.5 items-center cursor-pointer"
                    onClick={() => setExpandedId(prev => prev === thread.id ? null : thread.id)}
                  >
                    {/* Member */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0',
                        ROLE_COLORS[thread.owner_role as TeamRole]?.bg ?? 'bg-slate-100 dark:bg-slate-700',
                        ROLE_COLORS[thread.owner_role as TeamRole]?.text ?? 'text-slate-600'
                      )}>
                        {thread.owner_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate leading-tight">
                          {thread.owner_name}
                        </p>
                        <RoleTag role={thread.owner_role} />
                      </div>
                    </div>

                    {/* From */}
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {thread.from_email ?? '—'}
                    </span>

                    {/* Subject */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      {expandedId === thread.id
                        ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
                      }
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                        {(thread.subject ?? '(no subject)').slice(0, 60)}
                        {(thread.subject?.length ?? 0) > 60 ? '…' : ''}
                      </span>
                    </div>

                    {/* Received */}
                    <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
                      {thread.received_at
                        ? formatDistanceToNow(new Date(thread.received_at), { addSuffix: true })
                        : '—'}
                    </span>

                    {/* Priority */}
                    <PriorityBadge priority={thread.highest_priority} />

                    {/* Reply status */}
                    <ResponseBadge
                      replyStatus={thread.reply_status}
                      receivedAt={thread.received_at}
                      responseMinutes={thread.response_minutes}
                    />

                    {/* Tasks chip */}
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap',
                      thread.pending_task_count > 0
                        ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                    )}>
                      {thread.task_count} task{thread.task_count !== 1 ? 's' : ''}
                    </span>

                    {/* Reply action */}
                    <button
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0"
                      onClick={e => { e.stopPropagation(); setReplyThread(thread) }}
                      title="Reply"
                    >
                      <MessageSquareReply className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Expanded panel: AI Summary + Conversation Timeline */}
                  {expandedId === thread.id && (
                    <div className="px-5 pb-4 animate-slide-down space-y-3">
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-blue-100 dark:border-blue-900/40 p-4">
                        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                          AI Summary
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                          {thread.summary ?? 'No summary available.'}
                        </p>
                        {thread.email_link && (
                          <a
                            href={thread.email_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-3 text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Open Email
                          </a>
                        )}
                      </div>

                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">
                          Conversation
                        </p>
                        <ThreadTree
                          threadId={thread.id}
                          memberEmail={thread.owner_email}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── pagination ───────────────────────────────────────────────────── */}
        {hasMore && (
          <div className="mt-4 text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
              className="text-sm border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl px-6"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>

      {replyThread && (
        <ReplyComposer
          thread={replyThread}
          isOpen={true}
          onClose={() => setReplyThread(null)}
          onReplySent={() => fetchThreads(0, false)}
        />
      )}
    </>
  )
}
