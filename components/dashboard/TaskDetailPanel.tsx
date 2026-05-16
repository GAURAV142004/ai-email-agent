'use client'

import { useState, useEffect } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  SheetDescription, SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { StatusBadge } from './StatusBadge'
import { PriorityBadge } from './PriorityBadge'
import { ThreadTree } from './ThreadTree'
import { ResponseBadge } from './ResponseBadge'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, MessageSquareReply, Calendar, Tag } from 'lucide-react'
import type { Task, ThreadWithMember, TaskStatus, TaskPriority } from '@/lib/supabase/types'

interface TaskDetailPanelProps {
  task:          Task | null
  isOpen:        boolean
  onClose:       () => void
  onTaskUpdated: (updated: Task) => void
  onReply?:      (thread: ThreadWithMember) => void
}

export function TaskDetailPanel({ task, isOpen, onClose, onTaskUpdated, onReply }: TaskDetailPanelProps) {
  const [thread,         setThread]         = useState<ThreadWithMember | null>(null)
  const [threadLoading,  setThreadLoading]  = useState(false)
  const [showTree,       setShowTree]       = useState(false)
  const [savingStatus,   setSavingStatus]   = useState(false)
  const [savingPriority, setSavingPriority] = useState(false)

  useEffect(() => {
    if (!task?.thread_id) {
      setThread(null)
      return
    }
    setThreadLoading(true)
    setShowTree(false)
    fetch(`/api/threads/${task.thread_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setThread(d?.thread ?? null)
        setThreadLoading(false)
      })
      .catch(() => setThreadLoading(false))
  }, [task?.thread_id])

  async function handleStatusChange(newStatus: TaskStatus) {
    if (!task || task.status === newStatus) return
    setSavingStatus(true)
    const optimistic = { ...task, status: newStatus }
    onTaskUpdated(optimistic)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      onTaskUpdated(data.task ?? optimistic)
      toast.success('Status updated')
    } catch {
      onTaskUpdated(task)
      toast.error('Failed to update status')
    }
    setSavingStatus(false)
  }

  async function handlePriorityChange(newPriority: TaskPriority) {
    if (!task || task.priority === newPriority) return
    setSavingPriority(true)
    const optimistic = { ...task, priority: newPriority }
    onTaskUpdated(optimistic)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: newPriority }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      onTaskUpdated(data.task ?? optimistic)
      toast.success('Priority updated')
    } catch {
      onTaskUpdated(task)
      toast.error('Failed to update priority')
    }
    setSavingPriority(false)
  }

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:w-[580px] sm:max-w-[580px] flex flex-col gap-0 p-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <SheetTitle className="text-base font-semibold text-slate-900 dark:text-white leading-snug pr-8">
            {task?.task ?? 'Task Detail'}
          </SheetTitle>
          <SheetDescription className="text-xs text-slate-400">
            Created {task ? formatDistanceToNow(new Date(task.created_at), { addSuffix: true }) : ''}
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Meta row — status + priority + date */}
          <div className="flex items-start gap-4 flex-wrap">

            {/* Status selector */}
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                Status
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {(['pending', 'in_progress', 'completed', 'ignored'] as TaskStatus[]).map(s => (
                  <button
                    key={s}
                    disabled={savingStatus}
                    onClick={() => handleStatusChange(s)}
                    className={cn(
                      'transition-all duration-150 rounded-lg',
                      task?.status === s
                        ? 'ring-2 ring-blue-500/50 ring-offset-1'
                        : 'opacity-60 hover:opacity-100',
                    )}
                  >
                    <StatusBadge status={s} />
                  </button>
                ))}
              </div>
            </div>

            {/* Priority selector */}
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                Priority
              </p>
              <div className="flex gap-1.5">
                {(['high', 'medium', 'low'] as TaskPriority[]).map(p => (
                  <button
                    key={p}
                    disabled={savingPriority}
                    onClick={() => handlePriorityChange(p)}
                    className={cn(
                      'transition-all duration-150 rounded-lg',
                      task?.priority === p
                        ? 'ring-2 ring-blue-500/50 ring-offset-1'
                        : 'opacity-60 hover:opacity-100',
                    )}
                  >
                    <PriorityBadge priority={p} />
                  </button>
                ))}
              </div>
            </div>

            {/* Created date */}
            <div className="space-y-1 ml-auto">
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                Created
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {task ? format(new Date(task.created_at), 'dd MMM yyyy, h:mm a') : '—'}
              </p>
            </div>
          </div>

          {/* Task description */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
              <Tag className="w-3 h-3" />
              Task Description
            </p>
            <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
              {task?.task}
            </p>
          </div>

          {/* Related email thread */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
              <MessageSquareReply className="w-3 h-3" />
              Related Email Thread
            </p>

            {threadLoading && (
              <div className="space-y-2 animate-pulse">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
              </div>
            )}

            {!threadLoading && thread && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">

                {/* Thread summary */}
                <div className="p-4 space-y-2">
                  <p className="font-medium text-sm text-slate-900 dark:text-white leading-snug">
                    {thread.subject ?? '(No subject)'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                    <span>From {thread.from_email}</span>
                    <span>·</span>
                    <span>
                      {thread.received_at
                        ? formatDistanceToNow(new Date(thread.received_at), { addSuffix: true })
                        : '—'}
                    </span>
                  </div>
                  <ResponseBadge
                    replyStatus={thread.reply_status ?? null}
                    receivedAt={thread.received_at ?? null}
                    responseMinutes={thread.response_minutes ?? null}
                  />
                  {thread.summary && (
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                      {thread.summary}
                    </p>
                  )}
                </div>

                {/* Expand/collapse thread tree */}
                <button
                  onClick={() => setShowTree(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <span>{showTree ? 'Hide conversation' : 'Show conversation'}</span>
                  {showTree
                    ? <ChevronUp className="w-3.5 h-3.5" />
                    : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showTree && (
                  <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700">
                    <ThreadTree
                      threadId={thread.id}
                      memberEmail={thread.owner_email}
                    />
                  </div>
                )}
              </div>
            )}

            {!threadLoading && !thread && task?.thread_id && (
              <p className="text-sm text-slate-400 dark:text-slate-500 italic">
                Thread not found or no longer accessible.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <SheetFooter className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex flex-row justify-between shrink-0">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {thread && (
            <Button
              variant="default"
              onClick={() => {
                onClose()
                onReply?.(thread)
              }}
              className="gap-2"
            >
              <MessageSquareReply className="w-4 h-4" />
              Reply to Email
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
