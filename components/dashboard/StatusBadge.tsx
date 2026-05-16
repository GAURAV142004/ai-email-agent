'use client'

import { Badge } from '@/components/ui/badge'
import type { TaskStatus } from '@/lib/supabase/types'

const config: Record<TaskStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  pending:     { label: 'Pending',     variant: 'outline', className: 'border-slate-300 text-slate-500 bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:bg-slate-800' },
  in_progress: { label: 'In Progress', variant: 'outline', className: 'border-blue-300 text-blue-700 bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:bg-blue-500/10 animate-pulse' },
  completed:   { label: 'Completed',   variant: 'outline', className: 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:bg-emerald-500/10' },
  ignored:     { label: 'Ignored',     variant: 'outline', className: 'border-gray-200 text-gray-400 bg-gray-50 dark:border-gray-700 dark:text-gray-500 dark:bg-gray-800/50' },
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { label, className } = config[status] ?? config.pending
  return (
    <Badge variant="outline" className={`text-xs font-medium ${className}`}>
      {label}
    </Badge>
  )
}
