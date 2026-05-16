'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Mail, CornerDownRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TimelineMessage } from '@/lib/supabase/types'

interface ThreadTimelineProps {
  threadId: string
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins  = minutes % 60
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  const days  = Math.floor(hours / 24)
  const rem   = hours % 24
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`
}

export function ThreadTimeline({ threadId }: ThreadTimelineProps) {
  const [messages, setMessages] = useState<TimelineMessage[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/threads/${threadId}/timeline`)
      .then(r => r.ok ? r.json() : { messages: [] })
      .then(d => { setMessages(d.messages ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [threadId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-slate-400 dark:text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs">Loading timeline…</span>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500 py-3">
        No messages tracked yet — timeline builds as emails are received or sent.
      </p>
    )
  }

  return (
    <div className="space-y-0 mt-3">
      {messages.map((msg, i) => {
        const isOut = msg.direction === 'outbound'
        return (
          <div key={msg.id} className="flex gap-3">
            {/* Spine */}
            <div className="flex flex-col items-center">
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                isOut
                  ? 'bg-blue-100 dark:bg-blue-500/20'
                  : 'bg-slate-100 dark:bg-slate-700',
              )}>
                {isOut
                  ? <CornerDownRight className="w-3 h-3 text-blue-500" />
                  : <Mail className="w-3 h-3 text-slate-400" />
                }
              </div>
              {i < messages.length - 1 && (
                <div className="w-px flex-1 min-h-[12px] bg-slate-200 dark:bg-slate-700 my-1" />
              )}
            </div>

            {/* Bubble */}
            <div className={cn(
              'flex-1 rounded-xl px-3 py-2.5 mb-2 text-xs',
              isOut
                ? 'bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-900/40'
                : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700',
            )}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  'font-semibold',
                  isOut ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300',
                )}>
                  {isOut ? 'Reply sent' : 'Received'}
                </span>

                {msg.source === 'app' && (
                  <span className="text-[10px] bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                    via app
                  </span>
                )}

                {msg.response_minutes != null && (
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full ml-auto',
                    msg.response_minutes <= 120
                      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                      : msg.response_minutes <= 480
                      ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-500'
                      : 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400',
                  )}>
                    {formatDuration(msg.response_minutes)} response
                  </span>
                )}
              </div>

              <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                {msg.from_name
                  ? `${msg.from_name} <${msg.from_email ?? ''}>`
                  : (msg.from_email ?? (isOut ? 'Team member' : 'External sender'))
                }
              </p>

              {msg.snippet && (
                <p className="text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed line-clamp-2">
                  {msg.snippet}
                </p>
              )}

              {msg.sent_at && (
                <p className="text-slate-400 dark:text-slate-500 mt-1 text-[11px]">
                  {formatDistanceToNow(new Date(msg.sent_at), { addSuffix: true })}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
