'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { TaskTable } from '@/components/dashboard/TaskTable'
import type { Task, TaskStatus } from '@/lib/supabase/types'

function TaskSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm animate-fade-in">
      <div className="grid grid-cols-[1fr_130px_100px_80px_100px] gap-4 px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50">
        {['Task', 'From', 'Priority', 'Status', 'Due'].map((h) => (
          <div key={h} className="h-3 w-14 skeleton rounded" />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_130px_100px_80px_100px] gap-4 px-5 py-4 border-b border-slate-100/60 dark:border-slate-800/60 last:border-0 animate-fade-in"
          style={{ animationDelay: `${i * 45}ms` }}
        >
          <div className="space-y-2">
            <div className="h-3.5 skeleton rounded" style={{ width: `${52 + (i % 4) * 11}%` }} />
            <div className="h-2.5 skeleton rounded w-28" />
          </div>
          <div className="h-3.5 skeleton rounded w-20 self-center" />
          <div className="h-6 skeleton rounded-full w-16 self-center" />
          <div className="h-6 skeleton rounded-full w-14 self-center" />
          <div className="h-3.5 skeleton rounded w-16 self-center" />
        </div>
      ))}
    </div>
  )
}

export default function TasksPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchTasks = useCallback(async () => {
    const res = await fetch('/api/tasks?limit=200')
    if (res.ok) {
      const data = await res.json()
      setTasks(data.tasks ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (session) fetchTasks()
  }, [session, fetchTasks])

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    )
  }

  if (status === 'loading' || !session) return null

  return (
    <>
      <Header
        title="All Tasks"
        subtitle={loading ? undefined : `${tasks.length} task${tasks.length !== 1 ? 's' : ''} total`}
      />
      <div className="p-6">
        {loading ? (
          <TaskSkeleton />
        ) : (
          <div className="animate-fade-in">
            <TaskTable
              tasks={tasks}
              onStatusChange={handleStatusChange}
              onFollowUp={() => {}}
            />
          </div>
        )}
      </div>
    </>
  )
}
