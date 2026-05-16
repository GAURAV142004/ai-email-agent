'use client'

import { Badge } from '@/components/ui/badge'
import type { ReplyStatus } from '@/lib/supabase/types'

interface ResponseBadgeProps {
  replyStatus: ReplyStatus | null
  receivedAt: string | null
  responseMinutes: number | null
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins  = minutes % 60
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  const days     = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
}

export function ResponseBadge({ replyStatus, receivedAt, responseMinutes }: ResponseBadgeProps) {
  if (replyStatus === 'replied' && responseMinutes != null) {
    return (
      <Badge variant="outline" className="text-xs font-medium gap-1 bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-700">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400" />
        Replied · {formatDuration(responseMinutes)}
      </Badge>
    )
  }

  if (replyStatus === 'overdue') {
    return (
      <Badge variant="outline" className="text-xs font-medium gap-1 bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        Overdue
      </Badge>
    )
  }

  if (replyStatus === 'no_reply_needed') {
    return (
      <Badge variant="outline" className="text-xs font-medium bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-900/20 dark:border-gray-700">
        —
      </Badge>
    )
  }

  if (replyStatus === 'pending' && receivedAt) {
    const elapsed = Math.floor((Date.now() - new Date(receivedAt).getTime()) / 60_000)

    if (elapsed < 120) {
      return (
        <Badge variant="outline" className="text-xs font-medium gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
          On Time · {formatDuration(elapsed)}
        </Badge>
      )
    }

    if (elapsed < 480) {
      return (
        <Badge variant="outline" className="text-xs font-medium gap-1 bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-500 dark:border-yellow-800">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500" />
          At Risk · {formatDuration(elapsed)}
        </Badge>
      )
    }

    return (
      <Badge variant="outline" className="text-xs font-medium gap-1 bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        Overdue · {formatDuration(elapsed)}
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="text-xs font-medium bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-900/20 dark:border-gray-700">
      —
    </Badge>
  )
}
