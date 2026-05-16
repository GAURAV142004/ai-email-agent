'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  Mail, CheckCircle2, Clock, AlertTriangle, ChevronDown, ChevronRight,
  MessageSquareReply, LayoutGrid, List, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer,
} from 'recharts'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type ColumnDef, type SortingState,
} from '@tanstack/react-table'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Header } from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ReplyComposer } from '@/components/dashboard/ReplyComposer'
import { ThreadTimeline } from '@/components/dashboard/ThreadTimeline'
import { ROLE_GROUPS, ROLE_COLORS, ROLE_LABELS, type TeamRole } from '@/lib/roles'
import { cn } from '@/lib/utils'
import type {
  MemberStat, StreamStat, OverdueThread, ThreadWithMember, ReplyStatus, TaskPriority,
} from '@/lib/supabase/types'

// ─── types ───────────────────────────────────────────────────────────────────

interface MonitorSummary {
  totalEmails: number
  repliedOnTime: number
  atRisk: number
  overdueCount: number
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins  = minutes % 60
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  const days  = Math.floor(hours / 24)
  const rem   = hours % 24
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`
}

function getStreamForRole(role: string): string {
  for (const group of ROLE_GROUPS) {
    if ((group.roles as string[]).includes(role)) return group.label
  }
  return 'Unknown'
}

function getBarColor(minutes: number | null): string {
  if (minutes === null) return '#94a3b8'
  if (minutes < 120)   return '#22c55e'
  if (minutes < 480)   return '#eab308'
  return '#ef4444'
}

function asThread(t: OverdueThread): ThreadWithMember {
  return {
    ...t,
    user_id:          '',
    summary:          null,
    email_link:       null,
    processed_at:     null,
    created_at:       t.received_at ?? '',
    owner_member_id:  null,
    owner_email:      '',
    owner_avatar_url: null,
    reply_status:     t.reply_status as ReplyStatus,
    replied_at:       null,
    response_minutes: null,
    pii_was_masked:   false,
    pii_types_found:  [],
    task_count:       0,
    pending_task_count: 0,
    highest_priority: 'medium' as TaskPriority,
  }
}

// ─── sub-components ───────────────────────────────────────────────────────────

function RoleTag({ role }: { role: string }) {
  const r = role as TeamRole
  const c = ROLE_COLORS[r] ?? { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400' }
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      {ROLE_LABELS[r] ?? role}
    </span>
  )
}

function MemberCell({ member }: { member: MemberStat }) {
  const r = member.role as TeamRole
  const c = ROLE_COLORS[r] ?? { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400' }
  const initials = member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0', c.bg, c.text)}>
        {initials}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate leading-tight">{member.name}</p>
        <RoleTag role={member.role} />
      </div>
    </div>
  )
}

function ResponseHealthBadge({ avgMinutes, overdueCount }: { avgMinutes: number | null; overdueCount: number }) {
  if (overdueCount > 0) return (
    <Badge variant="outline" className="text-xs gap-1 bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />Overdue
    </Badge>
  )
  if (avgMinutes === null) return (
    <Badge variant="outline" className="text-xs bg-slate-50 text-slate-400 border-slate-200 dark:bg-slate-800 dark:border-slate-700">No Data</Badge>
  )
  if (avgMinutes < 120) return (
    <Badge variant="outline" className="text-xs gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />On Time
    </Badge>
  )
  if (avgMinutes < 480) return (
    <Badge variant="outline" className="text-xs gap-1 bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-500 dark:border-yellow-800">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />At Risk
    </Badge>
  )
  return (
    <Badge variant="outline" className="text-xs gap-1 bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Overdue
    </Badge>
  )
}

// ─── summary cards ────────────────────────────────────────────────────────────

function SummaryCards({ summary }: { summary: MonitorSummary }) {
  const replyPct = summary.totalEmails > 0
    ? Math.round((summary.repliedOnTime / summary.totalEmails) * 100)
    : 0

  const cards = [
    {
      label: 'Emails Today', value: summary.totalEmails, icon: Mail,
      iconBg: 'bg-blue-50 dark:bg-blue-500/10', iconColor: 'text-blue-500',
      valueColor: 'text-slate-900 dark:text-white', accent: 'border-t-blue-500',
      glow: 'hover:shadow-blue-100 dark:hover:shadow-blue-500/10', pulse: false, subtitle: null,
    },
    {
      label: 'Replied On Time', value: summary.repliedOnTime, icon: CheckCircle2,
      iconBg: 'bg-emerald-50 dark:bg-emerald-500/10', iconColor: 'text-emerald-500',
      valueColor: 'text-emerald-600 dark:text-emerald-400', accent: 'border-t-emerald-500',
      glow: 'hover:shadow-emerald-100 dark:hover:shadow-emerald-500/10', pulse: false,
      subtitle: replyPct > 0 ? `${replyPct}% of total` : null,
    },
    {
      label: 'At Risk', value: summary.atRisk, icon: Clock,
      iconBg: 'bg-amber-50 dark:bg-amber-500/10', iconColor: 'text-amber-500',
      valueColor: 'text-amber-600 dark:text-amber-400', accent: 'border-t-amber-400',
      glow: 'hover:shadow-amber-100 dark:hover:shadow-amber-500/10', pulse: false, subtitle: null,
    },
    {
      label: 'Overdue', value: summary.overdueCount, icon: AlertTriangle,
      iconBg: 'bg-red-50 dark:bg-red-500/10', iconColor: 'text-red-500',
      valueColor: 'text-red-600 dark:text-red-400', accent: 'border-t-red-500',
      glow: 'hover:shadow-red-100 dark:hover:shadow-red-500/10',
      pulse: summary.overdueCount > 0, subtitle: null,
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      {cards.map(({ label, value, icon: Icon, iconBg, iconColor, valueColor, accent, glow, pulse, subtitle }, i) => (
        <div
          key={label}
          className={`relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 border-t-[3px] ${accent} p-5 shadow-sm ${glow} hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 animate-slide-up cursor-default`}
          style={{ animationDelay: `${i * 70}ms` }}
        >
          {pulse && (
            <div className="absolute inset-0 rounded-2xl ring-2 ring-red-400/60 animate-pulse pointer-events-none" />
          )}
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{label}</p>
            <div className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center`}>
              <Icon className={`w-4 h-4 ${iconColor}`} />
            </div>
          </div>
          <p className={`text-4xl font-bold tracking-tight ${valueColor} animate-number-pop`} style={{ animationDelay: `${i * 70 + 100}ms` }}>
            {value}
          </p>
          {subtitle && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{subtitle}</p>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── grouped view ─────────────────────────────────────────────────────────────

function GroupedView({ members, streams }: { members: MemberStat[]; streams: StreamStat[] }) {
  const streamMap = useMemo(() => {
    const m: Record<string, StreamStat> = {}
    for (const s of streams) m[s.stream] = s
    return m
  }, [streams])

  return (
    <div className="space-y-3">
      {ROLE_GROUPS.map(group => {
        const groupMembers = members.filter(m => (group.roles as string[]).includes(m.role))
        const streamStat   = streamMap[group.label]
        const overdueCount = streamStat?.overdue_count ?? groupMembers.reduce((s, m) => s + m.overdue_count, 0)

        return (
          <Collapsible key={group.label} defaultOpen>
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              <CollapsibleTrigger className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors cursor-pointer group">
                <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200 text-left">{group.label}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                  {groupMembers.length} member{groupMembers.length !== 1 ? 's' : ''}
                </span>
                {overdueCount > 0 && (
                  <span className="text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded-full font-medium">
                    {overdueCount} overdue
                  </span>
                )}
                <ChevronDown className="w-4 h-4 text-slate-400 transition-transform duration-200 group-data-[open]:rotate-0 rotate-[-90deg]" />
              </CollapsibleTrigger>

              <CollapsibleContent>
                {groupMembers.length === 0 ? (
                  <div className="px-5 py-4 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
                    No members in this stream.
                  </div>
                ) : (
                  <div className="border-t border-slate-100 dark:border-slate-800 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          {['Member','Emails','Replied','Pending','Overdue','Replies','Avg Time','Avg Followup','Awaiting','On Time %','Health'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {groupMembers.map(m => (
                          <tr key={m.id} className="border-b border-slate-50 dark:border-slate-800/50 last:border-0 hover:bg-slate-50/40 dark:hover:bg-slate-800/20 transition-colors">
                            <td className="px-4 py-3"><MemberCell member={m} /></td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{m.emails_today}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{m.replied_count}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{m.pending_count}</td>
                            <td className="px-4 py-3">
                              <span className={m.overdue_count > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-300'}>
                                {m.overdue_count}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-slate-600 dark:text-slate-300 font-medium">{m.total_replies_sent ?? m.total_replies ?? 0}</span>
                              {((m.app_reply_count ?? 0) + (m.gmail_reply_count ?? 0)) > 0 && (
                                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-none mt-0.5">
                                  {m.app_reply_count ?? 0} app / {m.gmail_reply_count ?? 0} Gmail
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {m.avg_response_minutes == null ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <span className={cn(
                                  'font-medium',
                                  m.avg_response_minutes < 120  ? 'text-emerald-600 dark:text-emerald-400' :
                                  m.avg_response_minutes < 480  ? 'text-yellow-600 dark:text-yellow-500' :
                                  'text-red-600 dark:text-red-400'
                                )}>
                                  {formatDuration(m.avg_response_minutes)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {m.avg_followup_minutes == null ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <span className={cn(
                                  'font-medium',
                                  m.avg_followup_minutes < 120  ? 'text-emerald-600 dark:text-emerald-400' :
                                  m.avg_followup_minutes < 480  ? 'text-yellow-600 dark:text-yellow-500' :
                                  'text-red-600 dark:text-red-400'
                                )}>
                                  {formatDuration(m.avg_followup_minutes)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                'font-medium',
                                (m.awaiting_reply_count ?? 0) > 0
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-400 dark:text-slate-500'
                              )}>
                                {m.awaiting_reply_count ?? 0}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                              {m.on_time_pct != null ? `${Math.round(m.on_time_pct)}%` : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <ResponseHealthBadge avgMinutes={m.avg_response_minutes} overdueCount={m.overdue_count} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleContent>
            </div>
          </Collapsible>
        )
      })}
    </div>
  )
}

// ─── flat view ────────────────────────────────────────────────────────────────

function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (!sorted) return <ArrowUpDown className="w-3 h-3 text-slate-400 ml-1 inline" />
  if (sorted === 'asc')  return <ArrowUp   className="w-3 h-3 text-blue-500 ml-1 inline" />
  return <ArrowDown className="w-3 h-3 text-blue-500 ml-1 inline" />
}

function FlatView({ members }: { members: MemberStat[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'overdue_count', desc: true },
    { id: 'avg_response_minutes', desc: true },
  ])

  const columns = useMemo<ColumnDef<MemberStat>[]>(() => [
    {
      id: 'member',
      header: 'Member',
      accessorFn: row => row.name,
      cell: ({ row }) => <MemberCell member={row.original} />,
    },
    {
      id: 'stream',
      header: 'Stream',
      accessorFn: row => getStreamForRole(row.role),
      cell: ({ getValue }) => (
        <span className="text-xs text-slate-500 dark:text-slate-400">{getValue() as string}</span>
      ),
    },
    { accessorKey: 'emails_today',  header: 'Emails',   cell: ({ getValue }) => <span className="text-xs">{getValue() as number}</span> },
    { accessorKey: 'replied_count', header: 'Replied',  cell: ({ getValue }) => <span className="text-xs">{getValue() as number}</span> },
    { accessorKey: 'pending_count', header: 'Pending',  cell: ({ getValue }) => <span className="text-xs">{getValue() as number}</span> },
    {
      accessorKey: 'overdue_count',
      header: 'Overdue',
      cell: ({ getValue }) => {
        const v = getValue() as number
        return <span className={cn('text-xs', v > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-300')}>{v}</span>
      },
    },
    {
      accessorKey: 'total_replies_sent',
      header: 'Replies',
      cell: ({ row }) => {
        const total = (row.original.total_replies_sent ?? row.original.total_replies) ?? 0
        const app   = row.original.app_reply_count   ?? 0
        const gm    = row.original.gmail_reply_count ?? 0
        return (
          <div>
            <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">{total}</span>
            {(app + gm) > 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-none mt-0.5">{app} app / {gm} Gmail</p>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'awaiting_reply_count',
      header: 'Awaiting',
      cell: ({ getValue }) => {
        const v = (getValue() as number) ?? 0
        return (
          <span className={cn('text-xs font-medium', v > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500')}>
            {v}
          </span>
        )
      },
    },
    {
      accessorKey: 'avg_response_minutes',
      header: 'Avg Time',
      cell: ({ getValue }) => {
        const v = getValue() as number | null
        if (v == null) return <span className="text-xs text-slate-400">—</span>
        return (
          <span className={cn(
            'text-xs font-medium',
            v < 120 ? 'text-emerald-600 dark:text-emerald-400' :
            v < 480 ? 'text-yellow-600 dark:text-yellow-500' :
            'text-red-600 dark:text-red-400'
          )}>
            {formatDuration(v)}
          </span>
        )
      },
    },
    {
      accessorKey: 'avg_followup_minutes',
      header: 'Avg Followup',
      cell: ({ getValue }) => {
        const v = getValue() as number | null
        if (v == null) return <span className="text-xs text-slate-400">—</span>
        return (
          <span className={cn(
            'text-xs font-medium',
            v < 120 ? 'text-emerald-600 dark:text-emerald-400' :
            v < 480 ? 'text-yellow-600 dark:text-yellow-500' :
            'text-red-600 dark:text-red-400'
          )}>
            {formatDuration(v)}
          </span>
        )
      },
    },
    {
      accessorKey: 'on_time_pct',
      header: 'On Time %',
      cell: ({ getValue }) => {
        const v = getValue() as number | null
        return <span className="text-xs text-slate-600 dark:text-slate-300">{v != null ? `${Math.round(v)}%` : '—'}</span>
      },
    },
    {
      id: 'health',
      header: 'Health',
      enableSorting: false,
      accessorFn: row => row.avg_response_minutes,
      cell: ({ row }) => <ResponseHealthBadge avgMinutes={row.original.avg_response_minutes} overdueCount={row.original.overdue_count} />,
    },
  ], [])

  const table = useReactTable({
    data: members,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="border-b border-slate-100 dark:border-slate-800">
                {hg.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={cn(
                      'px-4 py-3 text-left font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide whitespace-nowrap select-none',
                      header.column.getCanSort() && 'cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 transition-colors'
                    )}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && <SortIcon sorted={header.column.getIsSorted()} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="border-b border-slate-50 dark:border-slate-800/50 last:border-0 hover:bg-slate-50/40 dark:hover:bg-slate-800/20 transition-colors">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── overdue panel ────────────────────────────────────────────────────────────

function OverduePanel({ threads, onReply }: { threads: OverdueThread[]; onReply: (t: OverdueThread) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (threads.length === 0) return null

  return (
    <div className="mt-6">
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-3 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
        <span className="text-sm font-medium text-red-700 dark:text-red-400">
          {threads.length} thread{threads.length !== 1 ? 's' : ''} overdue — immediate attention needed
        </span>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                {['Member','Subject','From','Received','Time Overdue','Reply','Timeline'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {threads.map(t => {
                const elapsed = t.received_at
                  ? Math.floor((Date.now() - new Date(t.received_at).getTime()) / 60_000)
                  : null
                const expanded = expandedId === t.id
                return (
                  <>
                    <tr key={t.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-red-50/30 dark:hover:bg-red-900/10 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-700 dark:text-slate-200">{t.owner_name}</span>
                          <RoleTag role={t.owner_role} />
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <span className="truncate block text-slate-600 dark:text-slate-300">{t.subject ?? '(no subject)'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">{t.from_email ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400 dark:text-slate-500 whitespace-nowrap">
                        {t.received_at ? formatDistanceToNow(new Date(t.received_at), { addSuffix: true }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {elapsed != null ? (
                          <span className="text-red-600 dark:text-red-400 font-semibold">{formatDuration(elapsed)}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => onReply(t)}
                          className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                          title="Reply"
                        >
                          <MessageSquareReply className="w-3.5 h-3.5" />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedId(prev => prev === t.id ? null : t.id)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors"
                          title="View timeline"
                        >
                          {expanded
                            ? <ChevronDown className="w-3.5 h-3.5" />
                            : <ChevronRight className="w-3.5 h-3.5" />
                          }
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${t.id}-timeline`} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td colSpan={7} className="px-6 py-3 bg-slate-50/60 dark:bg-slate-800/20">
                          <ThreadTimeline threadId={t.id} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── response chart ───────────────────────────────────────────────────────────

function ResponseChart({ members }: { members: MemberStat[] }) {
  const data = members.map(m => ({
    name:                 m.name.split(' ')[0],
    avg_response_hours:   m.avg_response_minutes != null ? parseFloat((m.avg_response_minutes / 60).toFixed(1)) : 0,
    avg_response_minutes: m.avg_response_minutes,
  }))

  return (
    <div className="mt-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5">
      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-4">
        Avg Response Time (hours)
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <Tooltip
            content={({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null
              return (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs shadow-md">
                  <p className="font-medium text-slate-700 dark:text-slate-300">{label}</p>
                  <p className="text-slate-500 dark:text-slate-400">{payload[0].value}h avg response</p>
                </div>
              )
            }}
          />
          <Bar dataKey="avg_response_hours" radius={[4, 4, 0, 0]} isAnimationActive>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(entry.avg_response_minutes)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── page skeleton ────────────────────────────────────────────────────────────

function MonitorSkeleton() {
  return (
    <div className="p-6 animate-fade-in">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 skeleton rounded-2xl" style={{ animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
      <div className="h-10 skeleton rounded-xl mb-5 w-72" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 skeleton rounded-2xl mb-3" style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [members,         setMembers]         = useState<MemberStat[]>([])
  const [streams,         setStreams]          = useState<StreamStat[]>([])
  const [summary,         setSummary]          = useState<MonitorSummary>({ totalEmails: 0, repliedOnTime: 0, atRisk: 0, overdueCount: 0 })
  const [overdueThreads,  setOverdueThreads]   = useState<OverdueThread[]>([])
  const [loading,         setLoading]          = useState(true)
  const [viewMode,        setViewMode]         = useState<'grouped' | 'flat'>('grouped')
  const [replyThread,     setReplyThread]      = useState<ThreadWithMember | null>(null)

  // Role guard
  useEffect(() => {
    if (session && session.user?.role && session.user.role !== 'delivery_lead') {
      router.replace('/')
    }
  }, [session, router])

  // Restore view preference from localStorage (client-only)
  useEffect(() => {
    const saved = localStorage.getItem('monitor-view-preference') as 'grouped' | 'flat' | null
    if (saved === 'grouped' || saved === 'flat') setViewMode(saved)
  }, [])

  // Persist view preference
  useEffect(() => {
    localStorage.setItem('monitor-view-preference', viewMode)
  }, [viewMode])

  const fetchData = useCallback(async () => {
    const [statsRes, overdueRes] = await Promise.all([
      fetch('/api/monitor/stats'),
      fetch('/api/monitor/overdue'),
    ])

    if (statsRes.ok) {
      const d = await statsRes.json()
      setMembers(d.members ?? [])
      setStreams(d.streams ?? [])
      setSummary(d.summary ?? { totalEmails: 0, repliedOnTime: 0, atRisk: 0, overdueCount: 0 })
    }
    if (overdueRes.ok) {
      const d = await overdueRes.json()
      setOverdueThreads(d.threads ?? [])
    }

    setLoading(false)
  }, [])

  // Initial fetch
  useEffect(() => {
    if (session) fetchData()
  }, [session, fetchData])

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!session) return
    const id = setInterval(fetchData, 60_000)
    return () => clearInterval(id)
  }, [session, fetchData])

  if (status === 'loading' || !session) return <MonitorSkeleton />

  return (
    <>
      <Header title="Monitor" subtitle="Team response health" />

      <div className="p-6">
        {/* Summary cards */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 skeleton rounded-2xl" style={{ animationDelay: `${i * 70}ms` }} />
            ))}
          </div>
        ) : (
          <SummaryCards summary={summary} />
        )}

        {/* View toggle + heading */}
        <div className="flex items-center gap-3 mb-5">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1">
            Team Response Monitor
          </h2>
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 gap-0.5">
            <button
              onClick={() => setViewMode('grouped')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150',
                viewMode === 'grouped'
                  ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              )}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Grouped
            </button>
            <button
              onClick={() => setViewMode('flat')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150',
                viewMode === 'flat'
                  ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              )}
            >
              <List className="w-3.5 h-3.5" />
              Flat
            </button>
          </div>
        </div>

        {/* Main table section */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 skeleton rounded-2xl" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        ) : viewMode === 'grouped' ? (
          <GroupedView members={members} streams={streams} />
        ) : (
          <FlatView members={members} />
        )}

        {/* Response chart — flat view only */}
        {!loading && viewMode === 'flat' && members.length > 0 && (
          <ResponseChart members={members} />
        )}

        {/* Overdue panel */}
        {!loading && (
          <OverduePanel threads={overdueThreads} onReply={t => setReplyThread(asThread(t))} />
        )}
      </div>

      {replyThread && (
        <ReplyComposer
          thread={replyThread}
          isOpen={true}
          onClose={() => setReplyThread(null)}
          onReplySent={fetchData}
        />
      )}
    </>
  )
}
