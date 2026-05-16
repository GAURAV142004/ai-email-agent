'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import type { ThreadTreeNode } from '@/lib/supabase/types'

interface Summary {
  totalMessages: number
  inboundCount: number
  outboundCount: number
  firstResponseMinutes: number | null
  avgResponseMinutes: number | null
  awaitingReplySince: string | null
}

function formatResponseTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

function TreeNode({
  node,
  isLast,
}: {
  node: ThreadTreeNode
  isLast: boolean
  memberEmail: string
}) {
  const isOutbound = node.direction === 'outbound'
  const indentPx   = node.depth * 24

  return (
    <div style={{ marginLeft: `${indentPx}px` }}>
      {/* Connector */}
      {node.depth > 0 && (
        <div className="flex items-start gap-2 mb-1">
          <div className="flex flex-col items-center">
            <div className="w-px h-3 bg-slate-200 dark:bg-slate-700" />
            <div className="w-2 h-2 rounded-full border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
          </div>
        </div>
      )}

      {/* Message bubble row */}
      <div className={cn('flex gap-3 mb-3', isOutbound ? 'flex-row-reverse' : 'flex-row')}>
        {/* Avatar */}
        <div className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5',
          isOutbound
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
        )}>
          {node.from_name?.charAt(0)?.toUpperCase() ?? '?'}
        </div>

        {/* Content column */}
        <div className={cn(
          'flex-1 max-w-[85%] flex flex-col gap-1',
          isOutbound ? 'items-end' : 'items-start',
        )}>
          {/* Header row */}
          <div className={cn(
            'flex items-center gap-2 text-xs',
            isOutbound ? 'flex-row-reverse' : 'flex-row',
          )}>
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {isOutbound ? 'You' : (node.from_name || node.from_email)}
            </span>
            {node.sent_at && (
              <span className="text-slate-400 dark:text-slate-500">
                {formatDistanceToNow(new Date(node.sent_at), { addSuffix: true })}
              </span>
            )}
            {isOutbound && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                {node.source === 'app' ? 'via app' : 'via Gmail'}
              </span>
            )}
          </div>

          {/* Bubble */}
          <div className={cn(
            'rounded-2xl px-3 py-2 text-sm leading-relaxed',
            isOutbound
              ? 'bg-blue-600 text-white rounded-tr-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm',
          )}>
            {node.snippet || 'No preview available'}
            {(node.snippet?.length ?? 0) >= 200 && (
              <span className="opacity-60">…</span>
            )}
          </div>

          {/* Response time badge — outbound only */}
          {isOutbound && node.response_minutes !== null && (
            <div className={cn(
              'text-[11px] px-2 py-0.5 rounded-full',
              node.response_minutes <= 120
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                : node.response_minutes <= 480
                ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400',
            )}>
              ↩ replied in {formatResponseTime(node.response_minutes)}
            </div>
          )}
        </div>
      </div>

      {/* Children */}
      {node.children.map((child, i) => (
        <TreeNode
          key={child.id}
          node={child}
          isLast={i === node.children.length - 1}
          memberEmail=""
        />
      ))}
    </div>
  )
}

function TreeSkeleton() {
  return (
    <div className="space-y-4 py-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="flex gap-3" style={{ marginLeft: `${i * 16}px` }}>
          <div className="w-7 h-7 skeleton rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 skeleton rounded w-24" />
            <div className="h-10 skeleton rounded-2xl" style={{ width: `${70 - i * 10}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ThreadTree({
  threadId,
  memberEmail,
}: {
  threadId: string
  memberEmail: string
}) {
  const [tree,    setTree]    = useState<ThreadTreeNode[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/threads/${threadId}/timeline`)
      .then(r => r.ok ? r.json() : { tree: [], summary: null })
      .then(d => {
        setTree(d.tree ?? [])
        setSummary(d.summary ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [threadId])

  if (loading) return <TreeSkeleton />

  if (tree.length === 0) {
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500 py-3">
        No messages tracked yet — tree builds as emails are received or sent.
      </p>
    )
  }

  const elapsed = summary?.awaitingReplySince
    ? formatDistanceToNow(new Date(summary.awaitingReplySince), { addSuffix: false })
    : null

  return (
    <div>
      {/* Summary bar */}
      {summary && (
        <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500 mb-4 flex-wrap">
          <span className="font-medium text-slate-600 dark:text-slate-300">
            {summary.totalMessages} message{summary.totalMessages !== 1 ? 's' : ''}
          </span>
          <span>·</span>
          <span>{summary.inboundCount} received</span>
          <span>·</span>
          <span>{summary.outboundCount} sent</span>
          {summary.avgResponseMinutes !== null && (
            <>
              <span>·</span>
              <span>avg response {formatResponseTime(summary.avgResponseMinutes)}</span>
            </>
          )}
        </div>
      )}

      {/* Tree */}
      <div className="space-y-0">
        {tree.map((root, i) => (
          <TreeNode
            key={root.id}
            node={root}
            isLast={i === tree.length - 1}
            memberEmail={memberEmail}
          />
        ))}
      </div>

      {/* Status banner */}
      {summary && (
        <div className={cn(
          'mt-4 rounded-xl px-3 py-2.5 text-xs font-medium flex items-center gap-2',
          summary.awaitingReplySince
            ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40'
            : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40',
        )}>
          {summary.awaitingReplySince ? (
            <>⏳ Awaiting your reply · {elapsed} since last message</>
          ) : (
            <>✅ You replied · waiting for client response</>
          )}
        </div>
      )}
    </div>
  )
}
