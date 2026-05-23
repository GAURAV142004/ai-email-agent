'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatRelativeDate } from '@/lib/utils'
import type { PersonalInboxEmail, AIPriority } from '@/lib/supabase/types'
import { Mail, MailOpen, Reply, X } from 'lucide-react'

// ── Priority badge config ─────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<AIPriority, { label: string; className: string; dot: string }> = {
  high:   { label: 'High',   className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',       dot: 'bg-red-500' },
  medium: { label: 'Medium', className: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800', dot: 'bg-yellow-500' },
  low:    { label: 'Low',    className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',   dot: 'bg-green-500' },
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PersonalEmailCardProps {
  email:       PersonalInboxEmail
  onMarkRead:  (id: string) => void
  onReply:     (email: PersonalInboxEmail) => void
  onDismiss?:  (id: string) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PersonalEmailCard({
  email,
  onMarkRead,
  onReply,
  onDismiss,
}: PersonalEmailCardProps) {
  const priority = email.ai_priority
  const pc       = priority ? PRIORITY_CONFIG[priority] : null

  const senderDisplay = email.from_name
    ? `${email.from_name}`
    : (email.from_email ?? 'Unknown sender')

  return (
    <div
      className={cn(
        'group relative rounded-xl border transition-all duration-150',
        'hover:shadow-sm',
        email.is_read
          ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          : 'bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/40',
      )}
    >
      <div className="px-4 py-3 space-y-1.5">
        {/* Top row: sender + time + priority badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Read/unread indicator */}
            <span className="shrink-0">
              {email.is_read
                ? <MailOpen className="w-3.5 h-3.5 text-slate-400" />
                : <Mail className="w-3.5 h-3.5 text-blue-500" />}
            </span>
            <span className={cn(
              'text-sm truncate',
              email.is_read
                ? 'text-slate-600 dark:text-slate-400 font-normal'
                : 'text-slate-900 dark:text-white font-semibold',
            )}>
              {senderDisplay}
            </span>
            {email.from_name && email.from_email && (
              <span className="text-xs text-slate-400 dark:text-slate-500 truncate hidden sm:block">
                &lt;{email.from_email}&gt;
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pc && (
              <Badge
                variant="outline"
                className={cn('text-xs font-medium gap-1 border', pc.className)}
              >
                <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', pc.dot)} />
                {pc.label}
              </Badge>
            )}
            <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
              {formatRelativeDate(email.received_at)}
            </span>
          </div>
        </div>

        {/* Subject */}
        <p className={cn(
          'text-sm truncate',
          email.is_read
            ? 'text-slate-600 dark:text-slate-400'
            : 'text-slate-800 dark:text-slate-200 font-medium',
        )}>
          {email.subject ?? '(No subject)'}
        </p>

        {/* Snippet — 2-line clamp */}
        {email.snippet && (
          <p className="text-xs text-slate-500 dark:text-slate-500 leading-relaxed line-clamp-2">
            {email.snippet}
          </p>
        )}

        {/* AI summary if present */}
        {email.ai_summary && (
          <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed italic line-clamp-2">
            AI: {email.ai_summary}
          </p>
        )}

        {/* Action row */}
        <div className="flex items-center gap-1.5 pt-1">
          {!email.is_read && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => onMarkRead(email.id)}
            >
              <MailOpen className="w-3 h-3 mr-1" />
              Mark Read
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-blue-50 dark:hover:bg-blue-950 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-800"
            onClick={() => onReply(email)}
          >
            <Reply className="w-3 h-3 mr-1" />
            Reply
          </Button>
          {onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto"
              onClick={() => onDismiss(email.id)}
              title="Dismiss email"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
