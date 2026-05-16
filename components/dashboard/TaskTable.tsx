'use client'

import React, { useState } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { StatusBadge } from './StatusBadge'
import { PriorityBadge } from './PriorityBadge'
import { TaskCard } from './TaskCard'
import { formatDate, formatDueDate, truncate } from '@/lib/utils'
import type { Task, TaskStatus } from '@/lib/supabase/types'
import { ChevronDown, ExternalLink, Inbox, MessageSquareReply } from 'lucide-react'

const STATUS_OPTIONS: TaskStatus[] = ['pending', 'in_progress', 'completed', 'ignored']

interface TaskTableProps {
  tasks: Task[]
  onStatusChange: (taskId: string, status: TaskStatus) => Promise<void>
  onFollowUp: (task: Task) => void
  onTaskClick?: (task: Task) => void
}

export function TaskTable({ tasks, onStatusChange, onFollowUp, onTaskClick }: TaskTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)

  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
    setUpdating(taskId)
    await onStatusChange(taskId, status)
    setUpdating(null)
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <Inbox className="w-8 h-8 text-slate-300 dark:text-slate-600" />
        </div>
        <p className="text-base font-semibold text-slate-600 dark:text-slate-300">No tasks yet</p>
        <p className="text-sm text-slate-400 dark:text-slate-500 mt-1.5 max-w-xs leading-relaxed">
          Tasks extracted from your emails will appear here. Try syncing your inbox.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900 shadow-sm animate-fade-in">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
            <TableHead className="w-[170px] text-slate-500 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider py-3.5">From</TableHead>
            <TableHead className="text-slate-500 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">Task</TableHead>
            <TableHead className="w-[100px] text-slate-500 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">Priority</TableHead>
            <TableHead className="w-[130px] text-slate-500 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">Status</TableHead>
            <TableHead className="w-[110px] text-slate-500 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">Due</TableHead>
            <TableHead className="w-[110px] text-slate-500 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">Received</TableHead>
            <TableHead className="w-[100px] text-slate-500 dark:text-slate-400 font-semibold text-xs uppercase tracking-wider">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task, idx) => (
            <React.Fragment key={task.id}>
              <TableRow
                className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors duration-150 border-b border-slate-100 dark:border-slate-800/60 last:border-0 animate-fade-in ${expandedId === task.id ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''}`}
                style={{ animationDelay: `${idx * 25}ms` }}
                onClick={() => onTaskClick?.(task)}
              >
                <TableCell className="font-medium text-sm text-slate-600 dark:text-slate-300 py-4">
                  {truncate(task.email_threads?.from_email ?? '—', 22)}
                </TableCell>
                <TableCell className="text-sm text-slate-800 dark:text-slate-200 max-w-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold line-clamp-1">{task.task}</span>
                    {task.email_threads?.subject && (
                      <span className="text-slate-400 dark:text-slate-500 text-xs line-clamp-1">
                        {task.email_threads.subject}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <PriorityBadge priority={task.priority} />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="flex items-center gap-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 transition-opacity"
                      disabled={updating === task.id}
                    >
                      <StatusBadge status={task.status} />
                      <ChevronDown className="w-3 h-3 text-slate-400" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {STATUS_OPTIONS.map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onClick={() => handleStatusChange(task.id, s)}
                          className={task.status === s ? 'font-semibold bg-slate-50 dark:bg-slate-800' : ''}
                        >
                          <StatusBadge status={s} />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
                <TableCell className="text-sm text-slate-500 dark:text-slate-400">
                  {formatDueDate(task.due_date)}
                </TableCell>
                <TableCell className="text-sm text-slate-400 dark:text-slate-500">
                  {formatDate(task.created_at)}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    {task.email_threads?.email_link && (
                      <a
                        href={task.email_threads.email_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Open email"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10 px-2 rounded-lg"
                      onClick={() => onFollowUp(task)}
                      title="Draft reply"
                    >
                      <MessageSquareReply className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              {expandedId === task.id && (
                <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
                  <TableCell colSpan={7} className="p-0">
                    <TaskCard task={task} onClose={() => setExpandedId(null)} />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
