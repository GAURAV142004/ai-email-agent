'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  Sparkles, Send, Plus, Trash2, Bot, User,
  FileDown, RefreshCw, AlertTriangle, Clock,
  FolderOpen, ChevronRight, X, MessageSquare,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AgentConversation, AgentMessage } from '@/lib/supabase/types'

const LAST_CONV_KEY = 'agent_last_conv_id'

// ── Markdown renderer ─────────────────────────────────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

function renderMarkdown(content: string): string {
  const safe = escapeHtml(content)
  return safe
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1.5">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold text-slate-800 dark:text-slate-200 mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-slate-800 dark:text-slate-100">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
    .replace(/^[-•] (.+)$/gm, '<li class="ml-4 list-disc text-sm text-slate-700 dark:text-slate-300 leading-relaxed">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm text-slate-700 dark:text-slate-300 leading-relaxed">$1</li>')
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (m) => `<ul class="my-2 space-y-1">${m}</ul>`)
    .replace(/^(?!<[hul]|$)(.+)$/gm, '<p class="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">$1</p>')
    .replace(/\n{2,}/g, '\n')
}

// ── Document format selector ──────────────────────────────────────────────────
type DocFormat = 'xlsx' | 'csv' | 'pdf'

function FormatSelector({ onSelect, onCancel }: { onSelect: (f: DocFormat) => void; onCancel: () => void }) {
  const [fmt, setFmt] = useState<DocFormat>('xlsx')
  return (
    <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-700 animate-fade-in">
      <span className="text-xs font-medium text-blue-700 dark:text-blue-300 shrink-0">Export as:</span>
      <Select value={fmt} onValueChange={(v) => setFmt(v as DocFormat)}>
        <SelectTrigger className="h-8 w-28 text-xs border-blue-300 dark:border-blue-600"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
          <SelectItem value="csv">CSV (.csv)</SelectItem>
          <SelectItem value="pdf">PDF (.pdf)</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={() => onSelect(fmt)}>Generate</Button>
      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel}>Cancel</Button>
    </div>
  )
}

// ── Assistant message bubble ──────────────────────────────────────────────────
function AssistantBubble({ message }: { message: AgentMessage }) {
  const handleDownload = async () => {
    if (!message.document_filename) return
    const res = await fetch(`/api/documents/download?filename=${encodeURIComponent(message.document_filename)}`)
    if (!res.ok) return
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = message.document_filename; a.click()
    URL.revokeObjectURL(url)
  }

  if (message.was_blocked) {
    return (
      <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl">
        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-red-700 dark:text-red-400">Response blocked</p>
          {message.block_reason && <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{message.block_reason}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-sm leading-relaxed prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {message.kb_entries_referenced > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[11px] font-medium">
            <Sparkles className="w-3 h-3" />
            {message.kb_entries_referenced} KB {message.kb_entries_referenced === 1 ? 'entry' : 'entries'}
          </span>
        )}
        {message.project_clusters_referenced?.map((c) => (
          <Badge key={c} className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 text-[11px] px-2 py-0.5 rounded-full font-medium">{c}</Badge>
        ))}
      </div>
      {message.response_type === 'document' && message.document_filename && (
        <Button size="sm" variant="outline" className="gap-2 h-8 text-xs" onClick={handleDownload}>
          <FileDown className="w-3.5 h-3.5" />
          Download {message.document_filename}
        </Button>
      )}
    </div>
  )
}

// ── Project selection screen ──────────────────────────────────────────────────
function ProjectSelector({
  projects,
  loading,
  onSelect,
}: {
  projects: string[]
  loading: boolean
  onSelect: (focus: string | null) => void
}) {
  const [custom, setCustom] = useState('')

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 max-w-2xl mx-auto w-full">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-5 shadow-lg shadow-blue-500/25">
        <Sparkles className="w-7 h-7 text-white" />
      </div>

      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-1 text-center">
        What would you like to discuss?
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-8 leading-relaxed">
        Select a project to get focused, accurate answers from that project's emails and documents.
        Or start a general query across all projects.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading projects…
        </div>
      ) : (
        <div className="w-full space-y-4">
          {/* Project tiles */}
          {projects.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {projects.map((p) => (
                <button
                  key={p}
                  onClick={() => onSelect(p)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
                    <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate group-hover:text-blue-700 dark:group-hover:text-blue-300">
                    {p}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 ml-auto group-hover:text-blue-400" />
                </button>
              ))}
            </div>
          )}

          {/* Custom topic */}
          <div className="flex gap-2">
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) onSelect(custom.trim())
              }}
              placeholder="Type a custom topic or issue…"
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-blue-500 transition-all"
            />
            {custom.trim() && (
              <Button
                onClick={() => onSelect(custom.trim())}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4"
              >
                Start
              </Button>
            )}
          </div>

          {/* General option */}
          <button
            onClick={() => onSelect(null)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            General — no project filter
          </button>
        </div>
      )}
    </div>
  )
}

// ── Quick prompts ─────────────────────────────────────────────────────────────
const QUICK_PROMPTS = ['Project status', 'Pending tasks', 'Open issues', "This week's activity"]
const DOC_KEYWORDS  = ['excel', 'csv', 'pdf', 'report', 'sheet', 'export', 'download', 'spreadsheet']
const hasDocKw      = (t: string) => DOC_KEYWORDS.some((k) => t.toLowerCase().includes(k))

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AgentPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const initDone   = useRef(false)   // guard against double-init

  // Conversations
  const [conversations,   setConversations]   = useState<AgentConversation[]>([])
  const [currentConvId,   setCurrentConvId]   = useState<string | null>(null)
  const [projectFocus,    setProjectFocus]    = useState<string | null>(null)
  const [messages,        setMessages]        = useState<AgentMessage[]>([])

  // Projects available in KB
  const [availableProjects, setAvailableProjects] = useState<string[]>([])
  const [projectsLoading,   setProjectsLoading]   = useState(false)

  // UI state
  const [convsLoading,      setConvsLoading]      = useState(false)
  const [msgsLoading,       setMsgsLoading]       = useState(false)
  const [generating,        setGenerating]        = useState(false)
  const [input,             setInput]             = useState('')
  const [showFormatSelector,setShowFormatSelector] = useState(false)
  const [pendingQuery,      setPendingQuery]      = useState<string | null>(null)
  const [convLoadError,     setConvLoadError]     = useState<string | null>(null)

  // Whether we are in "select project" mode (new conversation, no messages yet)
  const selectingProject = currentConvId === null && messages.length === 0 && !generating && !msgsLoading

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  // ── One-time init when authenticated ──────────────────────────────────────
  useEffect(() => {
    if (status !== 'authenticated' || initDone.current) return
    initDone.current = true
    init()
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    // Load projects and conversations in parallel
    const [, convs] = await Promise.all([
      loadProjects(),
      fetchConversationList(),
    ])

    // Try to restore the last session (sessionStorage first, then newest conv)
    const lastId = sessionStorage.getItem(LAST_CONV_KEY)
    if (lastId && convs.some((c) => c.id === lastId)) {
      await loadConversation(lastId)
    } else if (convs.length > 0) {
      await loadConversation(convs[0].id)
    }
    // else: show project selector (selectingProject = true)
  }

  async function loadProjects() {
    setProjectsLoading(true)
    try {
      const res  = await fetch('/api/agent/projects')
      const data = await res.json()
      setAvailableProjects(data.projects ?? [])
    } catch {}
    finally { setProjectsLoading(false) }
  }

  async function fetchConversationList(): Promise<AgentConversation[]> {
    setConvsLoading(true)
    try {
      const res  = await fetch('/api/agent/conversations')
      if (!res.ok) return []
      const data = await res.json()
      const convs: AgentConversation[] = data.conversations ?? []
      setConversations(convs)
      return convs
    } catch {
      return []
    } finally {
      setConvsLoading(false)
    }
  }

  const loadConversation = useCallback(async (id: string) => {
    setCurrentConvId(id)
    setMsgsLoading(true)
    setMessages([])
    setConvLoadError(null)
    try {
      const res  = await fetch(`/api/agent/conversations/${id}`)
      if (!res.ok) {
        setConvLoadError('Could not load conversation. Please try again.')
        return
      }
      const data = await res.json()
      setMessages(data.messages ?? [])
      if (data.conversation?.project_focus) {
        setProjectFocus(data.conversation.project_focus)
      } else {
        setProjectFocus(null)
      }
      sessionStorage.setItem(LAST_CONV_KEY, id)
    } catch {
      setConvLoadError('Network error loading conversation.')
    } finally {
      setMsgsLoading(false)
    }
  }, [])

  function handleProjectSelect(focus: string | null) {
    setProjectFocus(focus)
    setMessages([])
    setCurrentConvId(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function startNewConversation() {
    setCurrentConvId(null)
    setMessages([])
    setProjectFocus(null)
    setInput('')
    setShowFormatSelector(false)
    setPendingQuery(null)
    setConvLoadError(null)
    sessionStorage.removeItem(LAST_CONV_KEY)
    // Return to project selector
  }

  async function deleteConversation(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await fetch(`/api/agent/conversations/${id}`, { method: 'DELETE' })
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (currentConvId === id) startNewConversation()
    if (sessionStorage.getItem(LAST_CONV_KEY) === id) sessionStorage.removeItem(LAST_CONV_KEY)
  }

  // ── Message sending ────────────────────────────────────────────────────────
  async function sendQuery(query: string, docFormat?: DocFormat) {
    if (!query.trim() || generating) return
    setGenerating(true)
    setShowFormatSelector(false)
    setPendingQuery(null)

    const tempId = 'temp-' + Date.now()
    const tempUserMsg: AgentMessage = {
      id: tempId,
      conversation_id: currentConvId ?? '',
      role: 'user',
      content: query,
      kb_entries_referenced: 0,
      project_clusters_referenced: [],
      response_type: 'text',
      document_filename: null,
      document_mime_type: null,
      tokens_used: null,
      was_blocked: false,
      block_reason: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])

    try {
      const res = await fetch('/api/agent/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question:       query,
          conversationId: currentConvId ?? undefined,
          projectFocus:   projectFocus ?? undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `Server error ${res.status}`)
      }

      const data = await res.json()
      const resolvedConvId = data.conversationId ?? currentConvId ?? ''

      if (!currentConvId && data.conversationId) {
        setCurrentConvId(data.conversationId)
        sessionStorage.setItem(LAST_CONV_KEY, data.conversationId)
        fetchConversationList()
      }

      // Patch temp user message with real conversation ID
      setMessages((prev) =>
        prev.map((m) => m.id === tempId ? { ...m, conversation_id: resolvedConvId } : m),
      )

      // Document generation path
      if ((data.responseType === 'document' || docFormat) && !data.wasBlocked) {
        const format = docFormat ?? 'xlsx'
        try {
          const docRes = await fetch('/api/documents/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, answer: data.answer, format, conversation_id: resolvedConvId }),
          })
          if (docRes.ok) {
            const docData = await docRes.json()
            setMessages((prev) => [...prev, {
              id: data.messageId ?? 'a-' + Date.now(),
              conversation_id: resolvedConvId,
              role: 'assistant' as const,
              content: data.answer,
              kb_entries_referenced: data.kbEntriesUsed ?? 0,
              project_clusters_referenced: data.projectClusters ?? [],
              response_type: 'document' as const,
              document_filename: docData.filename ?? null,
              document_mime_type: docData.mime_type ?? null,
              tokens_used: data.tokensUsed ?? null,
              was_blocked: false,
              block_reason: null,
              created_at: new Date().toISOString(),
            }])
            return
          }
        } catch {}
      }

      setMessages((prev) => [...prev, {
        id: data.messageId ?? 'a-' + Date.now(),
        conversation_id: resolvedConvId,
        role: 'assistant' as const,
        content: data.answer ?? data.blockReason ?? 'No response received.',
        kb_entries_referenced: data.kbEntriesUsed ?? 0,
        project_clusters_referenced: data.projectClusters ?? [],
        response_type: (data.responseType ?? 'text') as any,
        document_filename: data.documentFilename ?? null,
        document_mime_type: null,
        tokens_used: data.tokensUsed ?? null,
        was_blocked: data.wasBlocked ?? false,
        block_reason: data.blockReason ?? null,
        created_at: new Date().toISOString(),
      }])
    } catch (err: any) {
      setMessages((prev) => [...prev, {
        id: 'err-' + Date.now(),
        conversation_id: currentConvId ?? '',
        role: 'assistant' as const,
        content: `Error: ${err?.message ?? 'Something went wrong. Please try again.'}`,
        kb_entries_referenced: 0,
        project_clusters_referenced: [],
        response_type: 'text' as const,
        document_filename: null,
        document_mime_type: null,
        tokens_used: null,
        was_blocked: false,
        block_reason: null,
        created_at: new Date().toISOString(),
      }])
    } finally {
      setGenerating(false)
    }
  }

  function handleSend() {
    const query = input.trim()
    if (!query || generating) return
    setInput('')
    if (hasDocKw(query)) { setPendingQuery(query); setShowFormatSelector(true); return }
    sendQuery(query)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, generating])

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      <Header title="Agent" subtitle="Knowledge base chatbot" />
      <div className="flex" style={{ height: 'calc(100vh - 4rem)' }}>

        {/* ── Left sidebar ─────────────────────────────────────────────── */}
        <aside className="w-64 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex flex-col shrink-0">
          <div className="p-3 border-b border-slate-200 dark:border-slate-700">
            <Button
              onClick={startNewConversation}
              className="w-full gap-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
            >
              <Plus className="w-4 h-4" />
              New Conversation
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {convsLoading && conversations.length === 0 && (
              <div className="flex justify-center py-8">
                <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />
              </div>
            )}
            {!convsLoading && conversations.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-8 px-4 leading-relaxed">
                No conversations yet.<br />Start by selecting a project below.
              </p>
            )}
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => loadConversation(conv.id)}
                className={cn(
                  'group flex items-start justify-between gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors',
                  currentConvId === conv.id
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <div className="flex-1 min-w-0">
                  {(conv as any).project_focus && (
                    <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide block truncate mb-0.5">
                      {(conv as any).project_focus}
                    </span>
                  )}
                  <p className={cn(
                    'text-sm font-medium truncate leading-tight',
                    currentConvId === conv.id ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300',
                  )}>
                    {conv.title ?? 'Untitled conversation'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true })}
                  </p>
                </div>
                <button
                  onClick={(e) => deleteConversation(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all shrink-0"
                  aria-label="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Right: chat area ──────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0">

          {/* Project context banner */}
          {projectFocus && !selectingProject && (
            <div className="flex items-center gap-2 px-5 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800">
              <FolderOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                Discussing: <strong>{projectFocus}</strong>
              </span>
              <button
                onClick={() => setProjectFocus(null)}
                className="ml-auto text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
                title="Remove project filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Messages / Project selector */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

            {/* Loading history */}
            {msgsLoading && (
              <div className="flex justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                  <p className="text-xs text-slate-400">Loading conversation…</p>
                </div>
              </div>
            )}

            {/* Conversation load error */}
            {convLoadError && !msgsLoading && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-sm text-red-600 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {convLoadError}
              </div>
            )}

            {/* Project selector (new conversation) */}
            {selectingProject && !msgsLoading && (
              <ProjectSelector
                projects={availableProjects}
                loading={projectsLoading}
                onSelect={handleProjectSelect}
              />
            )}

            {/* Project selected, no messages yet — prompt to type */}
            {!selectingProject && messages.length === 0 && !generating && !msgsLoading && projectFocus && (
              <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                  <FolderOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Ready to answer questions about <strong className="text-blue-700 dark:text-blue-300">{projectFocus}</strong>
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Ask anything — project status, action items, decisions, documents, client communications.
                </p>
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) => (
              <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full shrink-0 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mt-0.5">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className={cn(
                  'rounded-2xl',
                  msg.role === 'user'
                    ? 'max-w-[70%] bg-blue-600 text-white px-4 py-3'
                    : 'flex-1 max-w-[85%] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-5 py-4',
                )}>
                  {msg.role === 'user'
                    ? <p className="text-sm leading-relaxed">{msg.content}</p>
                    : <AssistantBubble message={msg} />
                  }
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full shrink-0 bg-slate-200 dark:bg-slate-700 flex items-center justify-center mt-0.5">
                    <User className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  </div>
                )}
              </div>
            ))}

            {/* Generating indicator */}
            {generating && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full shrink-0 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                    <span className="text-xs text-slate-400">
                      {projectFocus ? `Searching ${projectFocus} knowledge…` : 'Searching knowledge base…'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input area — only shown when a project/topic is selected or conversation is active */}
          {(!selectingProject || messages.length > 0 || generating) && (
            <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-3 space-y-2 bg-white dark:bg-slate-900/50">
              <div className="flex gap-2 flex-wrap">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setInput(p)}
                    className="text-[11px] px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>

              {showFormatSelector && pendingQuery && (
                <FormatSelector
                  onSelect={(f) => sendQuery(pendingQuery, f)}
                  onCancel={() => { setShowFormatSelector(false); setPendingQuery(null) }}
                />
              )}

              <div className="flex items-end gap-3">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    projectFocus
                      ? `Ask anything about ${projectFocus}…`
                      : "Ask anything about your team's project activity…"
                  }
                  rows={2}
                  className="flex-1 resize-none rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-blue-600 transition-all"
                  style={{ minHeight: '52px', maxHeight: '140px' }}
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || generating}
                  className="shrink-0 h-10 w-10 p-0 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors"
                  aria-label="Ask"
                >
                  {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-slate-400 text-center">
                Enter to send · Shift+Enter for new line · Type &quot;report&quot; or &quot;excel&quot; to export
              </p>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
