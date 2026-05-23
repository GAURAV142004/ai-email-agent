'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn, formatDueDate } from '@/lib/utils'
import type { DailyTodo, PersonalInboxEmail, TodoPriority, TodoStatus } from '@/lib/supabase/types'
import { Plus, Trash2, Link as LinkIcon, Calendar } from 'lucide-react'
import { isToday, parseISO } from 'date-fns'

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<TodoPriority, { label: string; className: string; dot: string }> = {
  high:   { label: 'High',   className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',              dot: 'bg-red-500' },
  medium: { label: 'Medium', className: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800', dot: 'bg-yellow-500' },
  low:    { label: 'Low',    className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',    dot: 'bg-green-500' },
}

const STATUS_ORDER: Record<TodoStatus, number> = {
  in_progress: 0,
  pending:     1,
  deferred:    2,
  completed:   3,
}

function sortTodos(todos: DailyTodo[]): DailyTodo[] {
  return [...todos].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (statusDiff !== 0) return statusDiff
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface DailyTodosProps {
  todos:    DailyTodo[]
  emails:   PersonalInboxEmail[]
  onUpdate: (id: string, patch: Partial<Pick<DailyTodo, 'status' | 'title' | 'priority'>>) => void
  onDelete: (id: string) => void
  onAdd:    (data: { title: string; priority: TodoPriority; linked_email_id?: string }) => void
}

// ── Add-task form ─────────────────────────────────────────────────────────────

interface AddTaskFormProps {
  emails:  PersonalInboxEmail[]
  onAdd:   DailyTodosProps['onAdd']
  onClose: () => void
}

function AddTaskForm({ emails, onAdd, onClose }: AddTaskFormProps) {
  const [title,          setTitle]          = useState('')
  const [priority,       setPriority]       = useState<TodoPriority>('medium')
  const [linkedEmailId,  setLinkedEmailId]  = useState<string>('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    onAdd({
      title:           trimmed,
      priority,
      linked_email_id: linkedEmailId || undefined,
    })
    setTitle('')
    setPriority('medium')
    setLinkedEmailId('')
    onClose()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2.5 mb-3"
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title…"
        className="h-9 text-sm bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
      />

      <div className="flex gap-2">
        {/* Priority */}
        <Select value={priority} onValueChange={(v) => setPriority(v as TodoPriority)}>
          <SelectTrigger className="h-8 text-xs flex-1 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        {/* Link to email */}
        <Select value={linkedEmailId} onValueChange={(v) => setLinkedEmailId(v ?? '')}>
          <SelectTrigger className="h-8 text-xs flex-1 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 max-w-[200px]">
            <SelectValue placeholder="Link email (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No linked email</SelectItem>
            {emails.map((em) => (
              <SelectItem key={em.id} value={em.id}>
                <span className="truncate max-w-[180px] block">
                  {em.subject ?? em.from_name ?? em.from_email ?? em.id}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!title.trim()}
          className="h-8 text-xs px-4 bg-blue-600 hover:bg-blue-700 text-white"
        >
          Add Task
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs px-3 text-slate-500"
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ── Todo row ──────────────────────────────────────────────────────────────────

interface TodoRowProps {
  todo:     DailyTodo
  emails:   PersonalInboxEmail[]
  onUpdate: DailyTodosProps['onUpdate']
  onDelete: DailyTodosProps['onDelete']
}

function TodoRow({ todo, emails, onUpdate, onDelete }: TodoRowProps) {
  const pc        = PRIORITY_CONFIG[todo.priority]
  const completed = todo.status === 'completed'
  const deferred  = todo.status === 'deferred'
  const faded     = completed || deferred

  // Resolve linked email subject
  const linkedEmail = todo.linked_email_id
    ? (todo.personal_inbox_emails ?? emails.find((e) => e.id === todo.linked_email_id))
    : null
  const linkedSubject = linkedEmail?.subject ?? null

  // Due date chip — only shown if not today
  const showDueDate = todo.due_date && !isToday(parseISO(todo.due_date))

  function handleCheckboxChange() {
    onUpdate(todo.id, {
      status: completed ? 'pending' : 'completed',
    })
  }

  return (
    <div className={cn(
      'group flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-all duration-150',
      faded
        ? 'bg-slate-50 dark:bg-slate-900/40 border-slate-100 dark:border-slate-800 opacity-60'
        : todo.status === 'in_progress'
          ? 'bg-blue-50/50 dark:bg-blue-950/10 border-blue-100 dark:border-blue-900/30'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
    )}>
      {/* Checkbox */}
      <button
        onClick={handleCheckboxChange}
        className={cn(
          'mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all duration-150',
          completed
            ? 'bg-green-500 border-green-500'
            : 'border-slate-300 dark:border-slate-600 hover:border-blue-400',
        )}
        title={completed ? 'Mark as pending' : 'Mark as completed'}
      >
        {completed && (
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <p className={cn(
          'text-sm leading-snug',
          completed || deferred
            ? 'line-through text-slate-400 dark:text-slate-600'
            : 'text-slate-800 dark:text-slate-200',
        )}>
          {todo.title}
        </p>

        {/* Chips row */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Priority badge */}
          <Badge
            variant="outline"
            className={cn('text-[10px] font-medium gap-1 h-4.5 px-1.5 border', pc.className)}
          >
            <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', pc.dot)} />
            {pc.label}
          </Badge>

          {/* Due date chip */}
          {showDueDate && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-full px-1.5 py-0.5">
              <Calendar className="w-2.5 h-2.5" />
              {formatDueDate(todo.due_date)}
            </span>
          )}

          {/* In-progress indicator */}
          {todo.status === 'in_progress' && (
            <span className="inline-flex items-center text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded-full px-1.5 py-0.5">
              In Progress
            </span>
          )}

          {/* Deferred indicator */}
          {deferred && (
            <span className="inline-flex items-center text-[10px] font-medium text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-800/50 rounded-full px-1.5 py-0.5">
              Deferred
            </span>
          )}

          {/* Linked email chip */}
          {linkedSubject && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 rounded-full px-1.5 py-0.5 max-w-[180px]">
              <LinkIcon className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{linkedSubject}</span>
            </span>
          )}
        </div>
      </div>

      {/* Delete button — visible on hover */}
      <button
        onClick={() => onDelete(todo.id)}
        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all shrink-0 mt-0.5"
        title="Delete task"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function DailyTodos({ todos, emails, onUpdate, onDelete, onAdd }: DailyTodosProps) {
  const [showForm, setShowForm] = useState(false)

  const sorted = sortTodos(todos)

  const completedCount = todos.filter((t) => t.status === 'completed').length
  const totalCount     = todos.length

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
            Today&apos;s Tasks
          </p>
          {totalCount > 0 && (
            <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-0.5">
              {completedCount}/{totalCount} completed
            </p>
          )}
        </div>
        {!showForm && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-blue-50 dark:hover:bg-blue-950 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-800"
            onClick={() => setShowForm(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add Task
          </Button>
        )}
      </div>

      {/* Inline add form */}
      {showForm && (
        <AddTaskForm
          emails={emails}
          onAdd={onAdd}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Todo list */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
            <Plus className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">No tasks for today</p>
          <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">
            Add your first task to get started
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              emails={emails}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
