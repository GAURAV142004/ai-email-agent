'use client'

import { Badge } from '@/components/ui/badge'
import type { TaskPriority } from '@/lib/supabase/types'

const config: Record<TaskPriority, { label: string; className: string; dot: string }> = {
  high: { label: 'High', className: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500' },
  medium: { label: 'Medium', className: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-400' },
  low: { label: 'Low', className: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400' },
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { label, className, dot } = config[priority] ?? config.medium
  return (
    <Badge variant="outline" className={`text-xs font-medium gap-1 ${className}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </Badge>
  )
}
