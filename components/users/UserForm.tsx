'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ROLE_LABELS, ROLE_COLORS, type TeamRole } from '@/lib/roles'
import type { TeamMember } from '@/lib/supabase/types'

const ALL_ROLES: TeamRole[] = [
  'delivery_lead', 'senior_ba', 'senior_mis', 'senior_developer',
  'ba', 'mis', 'developer',
]

// Roles the adder is allowed to create
const ALLOWED_ROLES: Record<TeamRole, TeamRole[]> = {
  delivery_lead:    ['senior_ba', 'senior_mis', 'senior_developer', 'ba', 'mis', 'developer'],
  senior_ba:        ['ba'],
  senior_mis:       ['mis'],
  senior_developer: ['developer'],
  ba:               [],
  mis:              [],
  developer:        [],
}

// For delivery_lead adding: which manager role to look up for the selected role
const MANAGER_FOR_ROLE: Partial<Record<TeamRole, TeamRole>> = {
  ba:        'senior_ba',
  mis:       'senior_mis',
  developer: 'senior_developer',
}

interface UserFormProps {
  member?:         TeamMember & { role: TeamRole }
  currentUserRole: TeamRole
  onSuccess:       (member: TeamMember) => void
  onCancel:        () => void
}

export function UserForm({ member, currentUserRole, onSuccess, onCancel }: UserFormProps) {
  const isEdit      = !!member
  const allowedRoles = isEdit ? ALL_ROLES : (ALLOWED_ROLES[currentUserRole] ?? [])

  const [name,      setName]      = useState(member?.name  ?? '')
  const [email,     setEmail]     = useState(member?.email ?? '')
  const [role,      setRole]      = useState<string>(member?.role ?? allowedRoles[0] ?? '')
  const [managerId, setManagerId] = useState<string>('')
  const [managers,  setManagers]  = useState<TeamMember[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Fetch eligible managers when role changes (delivery_lead adding only)
  useEffect(() => {
    if (isEdit || currentUserRole !== 'delivery_lead') return
    if (!role) { setManagers([]); return }

    const managerRole = MANAGER_FOR_ROLE[role as TeamRole]
    if (!managerRole) { setManagers([]); setManagerId(''); return }

    fetch('/api/users')
      .then(r => r.json())
      .then(data => {
        const eligible: TeamMember[] = (data.members ?? []).filter(
          (m: TeamMember) => m.role === managerRole && m.is_active
        )
        setManagers(eligible)
        if (eligible.length === 1) setManagerId(eligible[0].id)
        else setManagerId('')
      })
      .catch(() => { setManagers([]); setManagerId('') })
  }, [role, currentUserRole, isEdit])

  const handleSubmit = async () => {
    setError(null)

    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters.')
      return
    }
    if (!isEdit && (!email.includes('@') || !email.includes('.'))) {
      setError('Please enter a valid email address.')
      return
    }

    const orgDomain = process.env.NEXT_PUBLIC_ORG_DOMAIN
    if (!isEdit && orgDomain && !email.endsWith(`@${orgDomain}`)) {
      setError(`Email must end with @${orgDomain}`)
      return
    }

    setLoading(true)
    try {
      const body = isEdit
        ? { name: name.trim(), role }
        : { name: name.trim(), email: email.trim(), role, manager_id: managerId || null }

      const res = isEdit
        ? await fetch(`/api/users/${member!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })

      const data = await res.json()
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Something went wrong.')
        return
      }
      onSuccess(data.member)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const rolesForDropdown = allowedRoles.length > 0 ? allowedRoles : ALL_ROLES

  return (
    <div className="space-y-4">
      {/* Name */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Full Name</Label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Rahul Sharma"
          className="text-sm"
        />
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Work Email</Label>
        <Input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="name@company.com"
          disabled={isEdit}
          className={cn('text-sm', isEdit && 'bg-slate-50 dark:bg-slate-800 text-slate-400 cursor-not-allowed')}
        />
        {isEdit && (
          <p className="text-xs text-slate-400 dark:text-slate-500">Email cannot be changed after creation.</p>
        )}
      </div>

      {/* Role */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Role</Label>
        <Select value={role} onValueChange={v => setRole(v ?? '')}>
          <SelectTrigger className="text-sm border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-300">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rolesForDropdown.map(r => {
              const c = ROLE_COLORS[r]
              return (
                <SelectItem key={r} value={r}>
                  <div className="flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', c.bg)} />
                    <span>{ROLE_LABELS[r]}</span>
                  </div>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Reports To — delivery_lead adding only */}
      {!isEdit && currentUserRole === 'delivery_lead' && managers.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Reports To <span className="text-red-500">*</span>
          </Label>
          <Select value={managerId} onValueChange={v => setManagerId(v as string)}>
            <SelectTrigger className="text-sm border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-slate-300">
              <SelectValue>
                {managerId
                  ? managers.find(m => m.id === managerId)?.name ?? 'Select manager...'
                  : 'Select manager...'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {managers.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-slate-400 ml-1">
                      {ROLE_LABELS[m.role as TeamRole]}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!isEdit && currentUserRole === 'delivery_lead' && managers.length === 0 && role && (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic flex items-center gap-1">
          <span>ℹ️</span>
          Reports directly to Delivery Lead
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={loading}>
          {loading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          {isEdit ? 'Save Changes' : 'Add Member'}
        </Button>
      </div>
    </div>
  )
}
