'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { UserForm } from '@/components/users/UserForm'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ROLE_COLORS, ROLE_LABELS, type TeamRole } from '@/lib/roles'
import type { TeamMember } from '@/lib/supabase/types'
import { createClient } from '@/lib/supabase/client'

// ─── helpers ─────────────────────────────────────────────────────────────────

function RoleTag({ role }: { role: string }) {
  const r = role as TeamRole
  const c = ROLE_COLORS[r] ?? { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400' }
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      {ROLE_LABELS[r] ?? role}
    </span>
  )
}

function getInboxStatus(member: TeamMember) {
  if (!member.supabase_uid) {
    return {
      label: 'Invite Pending',
      icon:  '📨',
      color: 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800',
    }
  }
  if (!member.watch_expiry) {
    return {
      label: 'Not Connected',
      icon:  '○',
      color: 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700',
    }
  }
  if (new Date(member.watch_expiry) < new Date()) {
    return {
      label: 'Expired',
      icon:  '⚠',
      color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    }
  }
  return {
    label: 'Connected',
    icon:  '●',
    color: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30',
  }
}

function InboxBadge({ member }: { member: TeamMember }) {
  const { label, icon, color } = getInboxStatus(member)
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${color}`}>
      <span className="text-[10px]">{icon}</span>
      {label}
    </Badge>
  )
}

const CAN_ADD_ROLES = ['delivery_lead', 'senior_ba', 'senior_mis', 'senior_developer']

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ManageUsersPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [members,       setMembers]       = useState<TeamMember[]>([])
  const [loading,       setLoading]       = useState(true)
  const [showForm,      setShowForm]      = useState(false)
  const [editMember,    setEditMember]    = useState<TeamMember | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TeamMember | null>(null)
  const [deleting,      setDeleting]      = useState(false)
  const [togglingId,    setTogglingId]    = useState<string | null>(null)

  const userRole     = session?.user?.role as TeamRole | undefined
  const canAddMembers = userRole ? CAN_ADD_ROLES.includes(userRole) : false

  // Role guard: only manager roles can access this page
  useEffect(() => {
    if (session && userRole && !CAN_ADD_ROLES.includes(userRole)) {
      router.replace('/')
    }
  }, [session, userRole, router])

  // Fetch members
  useEffect(() => {
    if (!session) return
    fetch('/api/users')
      .then(r => r.json())
      .then(d => {
        setMembers(d.members ?? [])
        setLoading(false)
      })
  }, [session])

  // Realtime: merge in-place when any member row changes
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('team-members-status')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'team_members' },
        (payload) => {
          setMembers(prev => prev.map(m =>
            m.id === payload.new.id ? { ...m, ...payload.new as TeamMember } : m
          ))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const handleMemberAdded = (newMember: TeamMember) => {
    setMembers(prev => [...prev, newMember].sort((a, b) => a.name.localeCompare(b.name)))
    setShowForm(false)
    toast.success('Member added', { description: newMember.name })
  }

  const handleMemberUpdated = (updated: TeamMember) => {
    setMembers(prev => prev.map(m => m.id === updated.id ? updated : m))
    setEditMember(null)
    toast.success('Member updated')
  }

  const handleToggleActive = async (m: TeamMember) => {
    setTogglingId(m.id)
    const res = await fetch(`/api/users/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !m.is_active }),
    })
    if (res.ok) {
      setMembers(prev => prev.map(x => x.id === m.id ? { ...x, is_active: !x.is_active } : x))
      toast.success(m.is_active ? 'Member deactivated' : 'Member activated')
    } else {
      toast.error('Failed to update member status.')
    }
    setTogglingId(null)
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    const res = await fetch(`/api/users/${confirmDelete.id}`, { method: 'DELETE' })
    const data = await res.json()

    if (data.deactivated) {
      setMembers(prev => prev.map(m => m.id === confirmDelete.id ? { ...m, is_active: false } : m))
      toast.success('Member deactivated', { description: 'They had existing email history.' })
    } else if (data.deleted) {
      setMembers(prev => prev.filter(m => m.id !== confirmDelete.id))
      toast.success('Member removed')
    } else {
      toast.error(data.error ?? 'Failed to remove member.')
    }

    setConfirmDelete(null)
    setDeleting(false)
  }

  const handleResendInvite = async (m: TeamMember) => {
    const res = await fetch(`/api/users/${m.id}/invite`, { method: 'POST' })
    if (res.ok) {
      toast.success(`Invite resent to ${m.email}`)
    } else {
      toast.error('Failed to resend invite')
    }
  }

  // ── loading ─────────────────────────────────────────────────────────────────
  if (status === 'loading' || !session) return (
    <div className="p-6">
      <div className="h-10 skeleton rounded w-48 mb-6" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 skeleton rounded-xl mb-2" style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  )

  const activeCount = members.filter(m => m.is_active).length

  return (
    <>
      <Header title="Manage Team" subtitle={`${activeCount} active member${activeCount !== 1 ? 's' : ''}`} />

      <div className="p-6">
        {/* ── header row ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Team Members</h2>
            <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full font-medium">
              {members.length} total
            </span>
          </div>
          {canAddMembers && (
            <Button
              size="sm"
              onClick={() => setShowForm(true)}
              className="gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Member
            </Button>
          )}
        </div>

        {/* ── members table ────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="hidden lg:grid grid-cols-[2fr_1fr_1.5fr_90px_120px_110px_140px] gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
            <span>Member</span>
            <span>Role</span>
            <span>Manager</span>
            <span>Status</span>
            <span>Inbox</span>
            <span>Joined</span>
            <span className="text-right">Actions</span>
          </div>

          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 skeleton rounded-xl" style={{ animationDelay: `${i * 40}ms` }} />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm">
              No team members found.
            </div>
          ) : (
            members.map(m => {
              const r       = m.role as TeamRole
              const colors  = ROLE_COLORS[r] ?? { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-600 dark:text-slate-400' }
              const initials = m.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
              const isSelf  = m.id === (session.user as any)?.memberId
              const managerName = m.manager_id
                ? (members.find(x => x.id === m.manager_id)?.name ?? 'Unknown')
                : m.role === 'delivery_lead'
                  ? '—'
                  : 'Not assigned'

              return (
                <div
                  key={m.id}
                  className={cn(
                    'grid grid-cols-[2fr_1fr_1.5fr_90px_120px_110px_140px] gap-3 px-5 py-3.5 items-center border-b border-slate-100 dark:border-slate-800 last:border-0',
                    !m.is_active && 'opacity-60'
                  )}
                >
                  {/* Member */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0',
                      colors.bg, colors.text
                    )}>
                      {initials}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate leading-tight">
                        {m.name}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{m.email}</p>
                    </div>
                  </div>

                  {/* Role */}
                  <RoleTag role={m.role} />

                  {/* Manager */}
                  <span className={cn(
                    'text-xs truncate',
                    m.manager_id
                      ? 'text-slate-600 dark:text-slate-300'
                      : 'text-slate-400 dark:text-slate-500 italic'
                  )}>
                    {managerName}
                  </span>

                  {/* Status */}
                  {m.is_active ? (
                    <Badge variant="outline" className="text-xs gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800 w-fit">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1 bg-slate-50 text-slate-400 border-slate-200 dark:bg-slate-800 dark:border-slate-700 w-fit">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
                      Inactive
                    </Badge>
                  )}

                  {/* Inbox */}
                  <InboxBadge member={m} />

                  {/* Joined */}
                  <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
                    {m.created_at ? format(new Date(m.created_at), 'dd MMM yyyy') : '—'}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1">
                    {!m.supabase_uid && (
                      <button
                        onClick={() => handleResendInvite(m)}
                        className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                        title="Resend invite email"
                      >
                        📨 Resend
                      </button>
                    )}

                    {canAddMembers && (
                      <button
                        onClick={() => setEditMember(m)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        title="Edit member"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {!isSelf && userRole === 'delivery_lead' && (
                      <button
                        onClick={() => handleToggleActive(m)}
                        disabled={togglingId === m.id}
                        className={cn(
                          'px-2 py-1 rounded-lg text-xs font-medium transition-colors',
                          m.is_active
                            ? 'hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                            : 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                        )}
                        title={m.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {togglingId === m.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : m.is_active ? 'Deactivate' : 'Activate'
                        }
                      </button>
                    )}

                    {!isSelf && userRole === 'delivery_lead' && (
                      <button
                        onClick={() => setConfirmDelete(m)}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        title="Remove member"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Add Member dialog ───────────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={open => { if (!open) setShowForm(false) }}>
        <DialogContent className="max-w-md dark:bg-slate-900 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold dark:text-white">Add Team Member</DialogTitle>
          </DialogHeader>
          {userRole && (
            <UserForm
              currentUserRole={userRole}
              onSuccess={handleMemberAdded}
              onCancel={() => setShowForm(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Edit Member dialog ──────────────────────────────────────────────── */}
      <Dialog open={editMember !== null} onOpenChange={open => { if (!open) setEditMember(null) }}>
        <DialogContent className="max-w-md dark:bg-slate-900 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold dark:text-white">Edit Team Member</DialogTitle>
          </DialogHeader>
          {editMember && userRole && (
            <UserForm
              member={editMember as TeamMember & { role: TeamRole }}
              currentUserRole={userRole}
              onSuccess={handleMemberUpdated}
              onCancel={() => setEditMember(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation dialog ──────────────────────────────────────── */}
      <Dialog open={confirmDelete !== null} onOpenChange={open => { if (!open) setConfirmDelete(null) }}>
        <DialogContent className="max-w-md dark:bg-slate-900 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold dark:text-white">Remove Team Member</DialogTitle>
            <DialogDescription className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Are you sure you want to remove{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">{confirmDelete?.name}</span>?
              {' '}If they have email history, they will be deactivated instead of deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-800"
            >
              {deleting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Remove Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
