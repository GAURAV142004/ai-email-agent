'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatDate } from '@/lib/utils'
import type { PersonalInboxEmail, AIPriority } from '@/lib/supabase/types'
import { Reply, X, CheckCheck, Zap } from 'lucide-react'

// ── Priority config ───────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<AIPriority, { label: string; className: string; dot: string }> = {
  high:   { label: 'High',   className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',              dot: 'bg-red-500' },
  medium: { label: 'Medium', className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',  dot: 'bg-amber-500' },
  low:    { label: 'Low',    className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800', dot: 'bg-emerald-500' },
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500',
  'bg-emerald-500', 'bg-cyan-500', 'bg-pink-500', 'bg-indigo-500',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(' ').filter(Boolean)
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase()
  }
  return (email ?? '?').slice(0, 2).toUpperCase()
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PersonalEmailCardProps {
  email:      PersonalInboxEmail
  onMarkRead: (id: string) => void
  onReply:    (email: PersonalInboxEmail) => void
  onDismiss?: (id: string) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PersonalEmailCard({ email, onMarkRead, onReply, onDismiss }: PersonalEmailCardProps) {
  const priority = email.ai_priority
  const pc       = priority ? PRIORITY_CONFIG[priority] : null
  const initials = getInitials(email.from_name, email.from_email)
  const avatarBg = getAvatarColor(email.from_name ?? email.from_email ?? 'x')
  const sender   = email.from_name || email.from_email || 'Unknown sender'

  return (
    <div className={cn(
      'group relative rounded-xl border transition-all duration-150 cursor-default',
      'hover:shadow-md hover:-translate-y-px',
      email.is_read
        ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
        : 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/50',
    )}>
      {/* Unread left accent bar */}
      {!email.is_read && (
        <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-blue-500" />
      )}

      <div className="px-4 py-3 pl-5">
        {/* Row 1: avatar + sender + time + priority */}
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold shadow-sm',
            avatarBg,
          )}>
            {initials}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn(
                  'text-sm truncate',
                  email.is_read
                    ? 'text-slate-600 dark:text-slate-400 font-normal'
                    : 'text-slate-900 dark:text-white font-semibold',
                )}>
                  {sender}
                </span>
                {email.reply_sent && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded-full shrink-0 font-medium">
                    <CheckCheck className="w-2.5 h-2.5" />
                    Replied
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {pc && (
                  <Badge variant="outline" className={cn('text-[10px] font-medium gap-1 h-5 px-1.5 border hidden sm:flex', pc.className)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', pc.dot)} />
                    {pc.label}
                  </Badge>
                )}
                <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                  {formatDate(email.received_at)}
                </span>
              </div>
            </div>

            {/* Subject */}
            <p className={cn(
              'text-[13px] mt-0.5 truncate',
              email.is_read
                ? 'text-slate-500 dark:text-slate-500'
                : 'text-slate-800 dark:text-slate-200 font-medium',
            )}>
              {email.subject ?? '(No subject)'}
            </p>

            {/* AI summary OR snippet */}
            {(email.ai_summary || email.snippet) && (
              <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed line-clamp-1 mt-0.5">
                {email.ai_summary
                  ? <><span className="text-blue-500 dark:text-blue-400 font-medium">AI: </span>{email.ai_summary}</>
                  : email.snippet
                }
              </p>
            )}

            {/* Action row */}
            <div className="flex items-center gap-1.5 mt-2">
              {/* Actionable badge */}
              {email.is_actionable && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded-full">
                  <Zap className="w-2.5 h-2.5" />
                  Actionable
                </span>
              )}

              <div className="flex items-center gap-1.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                {!email.is_read && (
                  <button
                    onClick={() => onMarkRead(email.id)}
                    className="h-7 px-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors"
                  >
                    Mark Read
                  </button>
                )}
                {!email.reply_sent && (
                  <button
                    onClick={() => onReply(email)}
                    className="h-7 px-2.5 text-xs rounded-lg border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 font-medium transition-colors flex items-center gap-1"
                  >
                    <Reply className="w-3 h-3" />
                    Reply
                  </button>
                )}
                {onDismiss && (
                  <button
                    onClick={() => onDismiss(email.id)}
                    className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
