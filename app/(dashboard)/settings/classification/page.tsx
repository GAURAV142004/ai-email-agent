'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import {
  Shield, Plus, Trash2, Globe, Mail, AtSign, Hash, Sparkles, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TeamRole } from '@/lib/roles'
import type { EmailClassificationRule, ClassificationRuleType } from '@/lib/supabase/types'

// ── Rule type metadata ─────────────────────────────────────────────────────────
const RULE_TYPE_META: Record<
  ClassificationRuleType,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    color: string
    description: string
    placeholder: string
    emptyText: string
  }
> = {
  client_domain: {
    label: 'Client Domain',
    icon: Globe,
    color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700',
    description: 'Emails from or to this domain will be classified as project-related.',
    placeholder: 'e.g. infosys.com',
    emptyText:
      "No client domains configured. Add a domain like 'infosys.com' to automatically classify emails from that domain as project-related.",
  },
  sender_email: {
    label: 'Sender Email',
    icon: Mail,
    color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700',
    description: 'Emails sent by this exact address will be classified as project-related.',
    placeholder: 'e.g. manager@client.com',
    emptyText:
      "No sender emails configured. Add specific sender addresses to classify their emails automatically.",
  },
  receiver_email: {
    label: 'Receiver Email',
    icon: AtSign,
    color: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700',
    description: 'Emails addressed to this exact address will be classified as project-related.',
    placeholder: 'e.g. team@yourcompany.com',
    emptyText:
      "No receiver emails configured. Add team distribution lists or project inboxes to auto-classify their emails.",
  },
  subject_keyword: {
    label: 'Subject Keyword',
    icon: Hash,
    color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700',
    description: 'Emails whose subject contains this keyword (case-insensitive) will be classified as project-related.',
    placeholder: 'e.g. [PROJECT]',
    emptyText:
      "No subject keywords configured. Add keywords like '[PROJECT]' or 'Infosys' to classify emails by subject line.",
  },
  ai_inference: {
    label: 'AI Inference',
    icon: Sparkles,
    color: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-700',
    description: 'AI will infer whether an email is project-related based on its full content.',
    placeholder: '',
    emptyText:
      "AI inference is not enabled. Enable it to have the AI automatically classify ambiguous emails based on content.",
  },
}

const TAB_ORDER: Array<ClassificationRuleType | 'all'> = [
  'all',
  'client_domain',
  'sender_email',
  'receiver_email',
  'subject_keyword',
  'ai_inference',
]

const TAB_LABELS: Record<string, string> = {
  all: 'All',
  client_domain: 'Client Domains',
  sender_email: 'Sender Emails',
  receiver_email: 'Receiver Emails',
  subject_keyword: 'Keywords',
  ai_inference: 'AI Inference',
}

// ── Toggle switch ──────────────────────────────────────────────────────────────
function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
        ${checked ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm
          transition-transform duration-200
          ${checked ? 'translate-x-4' : 'translate-x-0'}
        `}
      />
    </button>
  )
}

// ── Rule card ──────────────────────────────────────────────────────────────────
function RuleCard({
  rule,
  onToggle,
  onDelete,
}: {
  rule: EmailClassificationRule
  onToggle: (id: string, active: boolean) => void
  onDelete: (id: string) => void
}) {
  const [toggling, setToggling] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const meta = RULE_TYPE_META[rule.rule_type]
  const Icon = meta.icon

  async function handleToggle(val: boolean) {
    setToggling(true)
    await onToggle(rule.id, val)
    setToggling(false)
  }

  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:shadow-sm transition-shadow">
      {/* Type badge + icon */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium shrink-0 mt-0.5 ${meta.color}`}>
        <Icon className="w-3 h-3" />
        {meta.label}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
          {rule.rule_type === 'ai_inference'
            ? 'AI Inference (no value needed)'
            : rule.value ?? '—'}
        </p>
        {rule.description && (
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{rule.description}</p>
        )}
        <p className="text-[11px] text-slate-300 dark:text-slate-600 mt-1">
          Added {new Date(rule.created_at).toLocaleDateString()}
        </p>
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-3 shrink-0">
        <ToggleSwitch
          checked={rule.is_active}
          onChange={handleToggle}
          disabled={toggling}
        />
        <span className="text-xs text-slate-400 w-16">
          {toggling ? 'Saving…' : rule.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Delete */}
      <div className="shrink-0">
        {confirming ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onDelete(rule.id)}
              className="px-2 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            aria-label="Delete rule"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyState({ type }: { type: ClassificationRuleType | 'all' }) {
  if (type === 'all') {
    return (
      <div className="text-center py-12">
        <Shield className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">No classification rules yet.</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          Add rules to control which emails are indexed into the knowledge base.
        </p>
      </div>
    )
  }
  const meta = RULE_TYPE_META[type]
  const Icon = meta.icon
  return (
    <div className="text-center py-12 px-6">
      <Icon className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-md mx-auto">
        {meta.emptyText}
      </p>
    </div>
  )
}

// ── Add rule dialog ────────────────────────────────────────────────────────────
function AddRuleDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [ruleType, setRuleType] = useState<ClassificationRuleType>('client_domain')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const meta = RULE_TYPE_META[ruleType]
  const needsValue = ruleType !== 'ai_inference'

  function reset() {
    setRuleType('client_domain')
    setValue('')
    setDescription('')
    setError(null)
    setSaving(false)
  }

  async function handleSave() {
    setError(null)
    if (needsValue && !value.trim()) {
      setError('Please enter a value for this rule type.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/classification-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_type: ruleType,
          value: needsValue ? value.trim() : null,
          description: description.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to save rule.')
        return
      }
      reset()
      onOpenChange(false)
      onSaved()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-blue-500" />
            Add Classification Rule
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Rule type */}
          <div className="space-y-1.5">
            <Label htmlFor="rule-type">Rule Type</Label>
            <Select
              value={ruleType}
              onValueChange={(v) => {
                setRuleType(v as ClassificationRuleType)
                setValue('')
                setError(null)
              }}
            >
              <SelectTrigger id="rule-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client_domain">Client Domain</SelectItem>
                <SelectItem value="sender_email">Sender Email</SelectItem>
                <SelectItem value="receiver_email">Receiver Email</SelectItem>
                <SelectItem value="subject_keyword">Subject Keyword</SelectItem>
                <SelectItem value="ai_inference">AI Inference</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-400 leading-relaxed">{meta.description}</p>
          </div>

          {/* Value */}
          {needsValue && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-value">Value</Label>
              <Input
                id="rule-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={meta.placeholder}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="rule-desc">
              Description{' '}
              <span className="text-slate-400 font-normal">(optional)</span>
            </Label>
            <Textarea
              id="rule-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note about why this rule exists…"
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {error && (
            <p className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </p>
          )}

          <Separator />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? 'Saving…' : 'Save Rule'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ClassificationRulesPage() {
  const { data: session } = useSession()
  const role = (session?.user as any)?.role as TeamRole | undefined

  const [rules, setRules] = useState<EmailClassificationRule[]>([])
  const [loadingRules, setLoadingRules] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('all')

  const fetchRules = useCallback(async () => {
    setLoadingRules(true)
    try {
      const res = await fetch('/api/admin/classification-rules')
      const data = await res.json()
      setRules(data.rules ?? [])
    } finally {
      setLoadingRules(false)
    }
  }, [])

  useEffect(() => {
    if (role === 'delivery_lead') fetchRules()
  }, [role, fetchRules])

  async function handleToggle(id: string, active: boolean) {
    // Optimistic update
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_active: active } : r)),
    )
    try {
      await fetch(`/api/admin/classification-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: active }),
      })
    } catch {
      // Revert on failure
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_active: !active } : r)),
      )
    }
  }

  async function handleDelete(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id))
    await fetch(`/api/admin/classification-rules/${id}`, { method: 'DELETE' })
  }

  // ── Access denied ────────────────────────────────────────────────────────────
  if (role && role !== 'delivery_lead') {
    return (
      <>
        <Header title="Classification Rules" subtitle="Email indexing configuration" />
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-4">
            <Shield className="w-7 h-7 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">
            Access Denied
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
            Only the Delivery Lead can manage email classification rules. Contact your Delivery Lead
            if you need changes made.
          </p>
        </div>
      </>
    )
  }

  // Filter rules by tab
  const visibleRules =
    activeTab === 'all'
      ? rules
      : rules.filter((r) => r.rule_type === activeTab)

  const countFor = (type: string) =>
    type === 'all' ? rules.length : rules.filter((r) => r.rule_type === type).length

  return (
    <>
      <Header title="Classification Rules" subtitle="Email indexing configuration" />

      <div className="p-6 max-w-4xl space-y-6">

        {/* Page header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">
                Email Classification Rules
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {rules.length} rule{rules.length !== 1 ? 's' : ''} configured ·{' '}
                {rules.filter((r) => r.is_active).length} active
              </p>
            </div>
          </div>
          <Button
            onClick={() => setDialogOpen(true)}
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Rule
          </Button>
        </div>

        {/* Explanation banner */}
        <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl">
          <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
            These rules determine which emails are indexed into the project knowledge base.{' '}
            <strong>Rules are checked before AI classification</strong> — matched emails are
            immediately classified without an extra LLM call.
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap gap-1 h-auto bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {TAB_ORDER.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="text-xs rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 data-[state=active]:shadow-sm px-3 py-1.5"
              >
                {TAB_LABELS[tab]}
                {countFor(tab) > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                    {countFor(tab)}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {TAB_ORDER.map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-4">
              {loadingRules ? (
                <div className="flex justify-center py-12">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : visibleRules.length === 0 ? (
                <EmptyState type={tab as ClassificationRuleType | 'all'} />
              ) : (
                <div className="space-y-2">
                  {visibleRules.map((rule) => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <AddRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={fetchRules}
      />
    </>
  )
}
