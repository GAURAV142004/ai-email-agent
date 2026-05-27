'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  Sparkles, Plus, Trash2, Bot, User,
  FileDown, RefreshCw, AlertTriangle, Clock,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import type { AgentConversation, AgentMessage } from '@/lib/supabase/types'

const LAST_CONV_KEY = 'agent_last_conv_id'

// ── Markdown renderer ─────────────────────────────────────────────────────────
function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

function renderMarkdown(raw: string): string {
  const s = escapeHtml(raw)
  return s
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-3 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h2 class="text-base font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-slate-800 dark:text-slate-100">$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em class="italic">$1</em>')
    .replace(/`(.+?)`/g,       '<code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-xs font-mono">$1</code>')
    .replace(/^[-•] (.+)$/gm,  '<li class="ml-4 list-disc leading-relaxed">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal leading-relaxed">$1</li>')
    .replace(/(<li[^>]*>[\s\S]*?<\/li>\n?)+/g, m => `<ul class="my-2 space-y-0.5 text-sm text-slate-700 dark:text-slate-300">${m}</ul>`)
    .replace(/^(?!<[hul\/]|$)(.+)$/gm, '<p class="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">$1</p>')
    .replace(/\n{2,}/g, '\n')
}

// ── Suggested starters ────────────────────────────────────────────────────────
const STARTERS = [
  { label: 'What is the current project status?', icon: '📊' },
  { label: 'What are the pending action items?',  icon: '✅' },
  { label: 'What did we discuss with the client this week?', icon: '💬' },
  { label: 'Generate a project summary report',   icon: '📄' },
]

// ── Assistant bubble ──────────────────────────────────────────────────────────
function AssistantBubble({ msg }: { msg: AgentMessage }) {
  async function download() {
    if (!msg.document_filename) return
    const res  = await fetch(`/api/documents/download?filename=${encodeURIComponent(msg.document_filename)}`)
    if (!res.ok) return
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: msg.document_filename })
    a.click(); URL.revokeObjectURL(url)
  }

  if (msg.was_blocked) {
    return (
      <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {msg.block_reason ?? 'This response was blocked.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <div
        className="text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
      />
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {msg.kb_entries_referenced > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[11px]">
            <Sparkles className="w-3 h-3" />
            {msg.kb_entries_referenced} source{msg.kb_entries_referenced !== 1 ? 's' : ''}
          </span>
        )}
        {(msg.project_clusters_referenced ?? []).map((c) => (
          <Badge key={c} className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 text-[11px] px-2 py-0.5 rounded-full">
            {c}
          </Badge>
        ))}
      </div>
      {msg.response_type === 'document' && msg.document_filename && (
        <Button size="sm" variant="outline" className="gap-2 h-7 text-xs" onClick={download}>
          <FileDown className="w-3.5 h-3.5" />
          Download {msg.document_filename}
        </Button>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AgentPage() {
  const { data: session, status } = useSession()
  const router   = useRouter()
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const initDone  = useRef(false)

  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [currentConvId, setCurrentConvId] = useState<string | null>(null)
  const [messages,      setMessages]      = useState<AgentMessage[]>([])
  const [input,         setInput]         = useState('')
  const [convsLoading,  setConvsLoading]  = useState(false)
  const [msgsLoading,   setMsgsLoading]   = useState(false)
  const [generating,    setGenerating]    = useState(false)
  const [loadError,     setLoadError]     = useState<string | null>(null)
  const [showDocFmt,    setShowDocFmt]    = useState(false)
  const [pendingQ,      setPendingQ]      = useState<string | null>(null)

  // ── Auth guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  // ── One-time init ────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'authenticated' || initDone.current) return
    initDone.current = true
    ;(async () => {
      const convs = await fetchConversationList()
      const lastId = typeof window !== 'undefined' ? sessionStorage.getItem(LAST_CONV_KEY) : null
      const target = lastId && convs.find(c => c.id === lastId) ? lastId
        : convs.length > 0 ? convs[0].id
        : null
      if (target) await loadConversation(target)
      else inputRef.current?.focus()
    })()
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, generating])

  // ── Conversation list ─────────────────────────────────────────────────────
  const fetchConversationList = useCallback(async (): Promise<AgentConversation[]> => {
    setConvsLoading(true)
    try {
      const res  = await fetch('/api/agent/conversations')
      if (!res.ok) return []
      const data = await res.json()
      const convs = (data.conversations ?? []) as AgentConversation[]
      setConversations(convs)
      return convs
    } catch { return [] }
    finally { setConvsLoading(false) }
  }, [])

  // ── Load a conversation ───────────────────────────────────────────────────
  const loadConversation = useCallback(async (id: string) => {
    setCurrentConvId(id)
    setMsgsLoading(true)
    setMessages([])
    setLoadError(null)
    setShowDocFmt(false)
    setPendingQ(null)
    try {
      const res = await fetch(`/api/agent/conversations/${id}`)
      if (!res.ok) { setLoadError('Could not load this conversation.'); return }
      const data = await res.json()
      setMessages(data.messages ?? [])
      sessionStorage.setItem(LAST_CONV_KEY, id)
    } catch {
      setLoadError('Network error — please try again.')
    } finally { setMsgsLoading(false) }
  }, [])

  // ── New conversation ──────────────────────────────────────────────────────
  function newConversation() {
    setCurrentConvId(null)
    setMessages([])
    setInput('')
    setLoadError(null)
    setShowDocFmt(false)
    setPendingQ(null)
    sessionStorage.removeItem(LAST_CONV_KEY)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // ── Delete conversation ───────────────────────────────────────────────────
  async function deleteConversation(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await fetch(`/api/agent/conversations/${id}`, { method: 'DELETE' })
    setConversations(prev => prev.filter(c => c.id !== id))
    if (currentConvId === id) newConversation()
    if (sessionStorage.getItem(LAST_CONV_KEY) === id) sessionStorage.removeItem(LAST_CONV_KEY)
  }

  // ── Send query ────────────────────────────────────────────────────────────
  const sendQuery = useCallback(async (query: string, docFormat?: 'xlsx' | 'csv' | 'pdf') => {
    if (!query.trim() || generating) return
    setGenerating(true)
    setShowDocFmt(false)
    setPendingQ(null)

    const tempId = `tmp-${Date.now()}`
    const tempMsg: AgentMessage = {
      id: tempId, conversation_id: currentConvId ?? '',
      role: 'user', content: query,
      kb_entries_referenced: 0, project_clusters_referenced: [],
      response_type: 'text', document_filename: null, document_mime_type: null,
      tokens_used: null, was_blocked: false, block_reason: null,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempMsg])

    try {
      const res = await fetch('/api/agent/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query, conversationId: currentConvId ?? undefined, docFormat }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? `Request failed (${res.status})`)
      }

      const data = await res.json()
      const resolvedConvId = data.conversationId ?? currentConvId ?? ''

      if (!currentConvId && data.conversationId) {
        setCurrentConvId(data.conversationId)
        sessionStorage.setItem(LAST_CONV_KEY, data.conversationId)
        fetchConversationList()
      }

      setMessages(prev =>
        prev.map(m => m.id === tempId ? { ...m, conversation_id: resolvedConvId } : m)
      )

      setMessages(prev => [...prev, {
        id: data.messageId ?? `a-${Date.now()}`,
        conversation_id: resolvedConvId,
        role: 'assistant' as const,
        content: data.answer ?? 'No response received.',
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
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, conversation_id: currentConvId ?? '',
        role: 'assistant' as const,
        content: `Something went wrong: ${err?.message ?? 'Please try again.'}`,
        kb_entries_referenced: 0, project_clusters_referenced: [],
        response_type: 'text' as const, document_filename: null,
        document_mime_type: null, tokens_used: null,
        was_blocked: false, block_reason: null,
        created_at: new Date().toISOString(),
      }])
    } finally {
      setGenerating(false)
    }
  }, [currentConvId, generating, fetchConversationList])

  function handleSend() {
    const q = input.trim()
    if (!q || generating) return
    setInput('')
    sendQuery(q)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isEmpty = messages.length === 0 && !generating && !msgsLoading

  return (
    <>
      <Header title="Agent" subtitle="Ask anything about your project knowledge base" />
      <div className="flex" style={{ height: 'calc(100vh - 4rem)' }}>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className="w-60 shrink-0 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex flex-col">
          <div className="p-3 border-b border-slate-200 dark:border-slate-700">
            <Button
              onClick={newConversation}
              className="w-full gap-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-9"
            >
              <Plus className="w-4 h-4" /> New Chat
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {convsLoading && conversations.length === 0 && (
              <div className="flex justify-center py-10">
                <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />
              </div>
            )}
            {!convsLoading && conversations.length === 0 && (
              <p className="text-[11px] text-slate-400 text-center py-10 px-3 leading-relaxed">
                No conversations yet. Start chatting below.
              </p>
            )}
            {conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => loadConversation(conv.id)}
                className={cn(
                  'group flex items-start justify-between gap-1.5 px-3 py-2.5 rounded-xl cursor-pointer transition-colors',
                  currentConvId === conv.id
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-[13px] font-medium truncate leading-tight',
                    currentConvId === conv.id
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-slate-700 dark:text-slate-300',
                  )}>
                    {conv.title ?? 'New conversation'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true })}
                  </p>
                </div>
                <button
                  onClick={e => deleteConversation(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all shrink-0 mt-0.5"
                  aria-label="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Chat area ─────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-950">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">

            {/* Loading */}
            {msgsLoading && (
              <div className="flex justify-center py-20">
                <div className="flex flex-col items-center gap-3">
                  <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                  <p className="text-xs text-slate-400">Loading conversation…</p>
                </div>
              </div>
            )}

            {/* Load error */}
            {loadError && !msgsLoading && (
              <div className="max-w-xl mx-auto mt-8 flex items-center gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-sm text-red-600 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {loadError}
              </div>
            )}

            {/* Empty state */}
            {isEmpty && !loadError && !msgsLoading && (
              <div className="flex flex-col items-center justify-center h-full max-w-xl mx-auto text-center gap-6">
                <div>
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/25">
                    <Sparkles className="w-7 h-7 text-white" />
                  </div>
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">
                    Project Knowledge Assistant
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    Ask anything in plain language. I understand context, remember our conversation,
                    and pull answers from your synced project emails and documents.
                  </p>
                </div>
                <div className="w-full grid grid-cols-2 gap-2">
                  {STARTERS.map(s => (
                    <button
                      key={s.label}
                      onClick={() => { setInput(s.label); setTimeout(() => inputRef.current?.focus(), 10) }}
                      className="flex items-start gap-2 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-left"
                    >
                      <span className="text-base leading-none mt-0.5">{s.icon}</span>
                      <span className="text-[13px] text-slate-600 dark:text-slate-400 leading-snug">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message list */}
            {messages.map(msg => (
              <div
                key={msg.id}
                className={cn('flex gap-3 max-w-4xl', msg.role === 'user' ? 'ml-auto flex-row-reverse' : '')}
              >
                <div className={cn(
                  'w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5',
                  msg.role === 'assistant'
                    ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                    : 'bg-slate-200 dark:bg-slate-700',
                )}>
                  {msg.role === 'assistant'
                    ? <Bot className="w-3.5 h-3.5 text-white" />
                    : <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  }
                </div>

                <div className={cn(
                  'rounded-2xl',
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white px-4 py-2.5 max-w-[72%]'
                    : 'bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-5 py-4 flex-1',
                )}>
                  {msg.role === 'user'
                    ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    : <AssistantBubble msg={msg} />
                  }
                </div>
              </div>
            ))}

            {/* Thinking indicator */}
            {generating && (
              <div className="flex gap-3 max-w-4xl">
                <div className="w-7 h-7 rounded-full shrink-0 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                          style={{ animationDelay: `${i * 0.18}s` }} />
                      ))}
                    </div>
                    <span className="text-xs text-slate-400">Thinking…</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 px-4 sm:px-8 py-4 space-y-2.5">

            {/* Compliance Warning */}
            <div className="flex items-center gap-2.5 px-4 py-3 bg-amber-50/70 dark:bg-amber-950/20 rounded-xl border border-amber-200/50 dark:border-amber-900/40">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-[11.5px] text-amber-700 dark:text-amber-300 leading-snug">
                <strong>Compliance Warning:</strong> Queries seeking personal or sensitive information (e.g. phone numbers, email addresses, personal contact info, salary details, health/leave status, personal life details) are strictly prohibited and monitored.
              </p>
            </div>

            {/* Doc format chooser (shown when agent returns a document intent) */}
            {showDocFmt && pendingQ && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-700">
                <span className="text-xs text-blue-700 dark:text-blue-300 font-medium shrink-0">Export as:</span>
                {(['xlsx', 'csv', 'pdf'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => { setShowDocFmt(false); sendQuery(pendingQ, f) }}
                    className="px-3 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 transition-colors"
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
                <button
                  onClick={() => { setShowDocFmt(false); setPendingQ(null) }}
                  className="ml-auto text-xs text-slate-400 hover:text-slate-600"
                >
                  Cancel
                </button>
              </div>
            )}

            <div className="flex items-end gap-3">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything — status, tasks, client updates, generate a report…"
                rows={2}
                className="flex-1 resize-none rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-blue-600 px-4 py-3 transition-all"
                style={{ minHeight: '52px', maxHeight: '180px' }}
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || generating}
                className="shrink-0 h-11 px-4 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors"
              >
                {generating
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <Sparkles className="w-4 h-4" />
                }
              </Button>
            </div>
            <p className="text-[11px] text-slate-400 text-center">
              Enter to send · Shift+Enter for new line · Say &quot;export to Excel&quot; to download a report
            </p>
          </div>
        </main>
      </div>
    </>
  )
}
