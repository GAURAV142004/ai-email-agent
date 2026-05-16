'use client'

import { Button } from '@/components/ui/button'
import { ExternalLink, X, User, Calendar, Sparkles } from 'lucide-react'
import type { Task } from '@/lib/supabase/types'
import { formatDueDate } from '@/lib/utils'

interface TaskCardProps {
  task: Task
  onClose: () => void
}

export function TaskCard({ task, onClose }: TaskCardProps) {
  const thread = task.email_threads

  return (
    <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 animate-slide-down">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1 mr-4">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug">{task.task}</p>
          {thread?.subject && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{thread.subject}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 -mt-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg shrink-0 transition-all duration-150"
          onClick={onClose}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {thread?.summary && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-blue-100 dark:border-blue-900/40 p-3.5 mb-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-blue-500" />
            <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest">Summary</p>
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{thread.summary}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
        {task.assigned_to && (
          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
            <User className="w-3 h-3 text-slate-400 dark:text-slate-500" />
            <span className="font-medium">{task.assigned_to}</span>
          </div>
        )}
        {task.due_date && (
          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
            <Calendar className="w-3 h-3 text-slate-400 dark:text-slate-500" />
            <span className="font-medium">{formatDueDate(task.due_date)}</span>
          </div>
        )}
        {thread?.email_link && (
          <a
            href={thread.email_link}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 rounded-lg px-2.5 py-1.5 transition-all duration-150 font-medium"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open Email</span>
          </a>
        )}
      </div>
    </div>
  )
}
