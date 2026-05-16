'use client'

import { ListTodo, Clock, Flame, CheckCheck } from 'lucide-react'
import type { Task } from '@/lib/supabase/types'

interface StatsProps {
  tasks: Task[]
}

const statConfig = [
  {
    label: 'Total Tasks',
    icon: ListTodo,
    iconBg: 'bg-blue-50 dark:bg-blue-500/10',
    iconColor: 'text-blue-500',
    valueColor: 'text-slate-900 dark:text-white',
    labelColor: 'text-slate-500 dark:text-slate-400',
    accent: 'border-t-blue-500',
    glow: 'hover:shadow-blue-100 dark:hover:shadow-blue-500/10',
  },
  {
    label: 'Pending',
    icon: Clock,
    iconBg: 'bg-amber-50 dark:bg-amber-500/10',
    iconColor: 'text-amber-500',
    valueColor: 'text-amber-600 dark:text-amber-400',
    labelColor: 'text-slate-500 dark:text-slate-400',
    accent: 'border-t-amber-400',
    glow: 'hover:shadow-amber-100 dark:hover:shadow-amber-500/10',
  },
  {
    label: 'High Priority',
    icon: Flame,
    iconBg: 'bg-red-50 dark:bg-red-500/10',
    iconColor: 'text-red-500',
    valueColor: 'text-red-600 dark:text-red-400',
    labelColor: 'text-slate-500 dark:text-slate-400',
    accent: 'border-t-red-500',
    glow: 'hover:shadow-red-100 dark:hover:shadow-red-500/10',
  },
  {
    label: 'Completed Today',
    icon: CheckCheck,
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/10',
    iconColor: 'text-emerald-500',
    valueColor: 'text-emerald-600 dark:text-emerald-400',
    labelColor: 'text-slate-500 dark:text-slate-400',
    accent: 'border-t-emerald-500',
    glow: 'hover:shadow-emerald-100 dark:hover:shadow-emerald-500/10',
  },
]

export function DailyDigest({ tasks }: StatsProps) {
  const total        = tasks.length
  const pending      = tasks.filter((t) => t.status === 'pending').length
  const highPriority = tasks.filter((t) => t.priority === 'high' && t.status !== 'completed').length
  const today        = new Date().toDateString()
  const completedToday = tasks.filter(
    (t) => t.status === 'completed' && new Date(t.updated_at).toDateString() === today
  ).length

  const values = [total, pending, highPriority, completedToday]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      {statConfig.map(({ label, icon: Icon, iconBg, iconColor, valueColor, labelColor, accent, glow }, i) => (
        <div
          key={label}
          className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 border-t-[3px] ${accent} p-5 shadow-sm ${glow} hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 animate-slide-up cursor-default`}
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <div className="flex items-center justify-between mb-4">
            <p className={`text-[11px] font-semibold ${labelColor} uppercase tracking-widest`}>{label}</p>
            <div className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center`}>
              <Icon className={`w-4 h-4 ${iconColor}`} />
            </div>
          </div>
          <p className={`text-4xl font-bold tracking-tight ${valueColor} animate-number-pop`} style={{ animationDelay: `${i * 70 + 100}ms` }}>
            {values[i]}
          </p>
        </div>
      ))}
    </div>
  )
}
