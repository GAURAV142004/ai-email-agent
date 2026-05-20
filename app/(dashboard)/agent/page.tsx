'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  Sparkles, Send, Plus, Filter, X,
  Mail, ChevronDown, ChevronUp,
  CheckSquare, Calendar, ExternalLink,
  Trash2, Clock,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { Header } from '@/components/layout/Header'
import type {
  AgentConversation, AgentMessage,
  ActionItem, TimelineEvent,
} from '@/lib/supabase/types'

// ── AssistantMessage component ─────────────────
function AssistantMessage({
  message,
  onThreadClick,
}: {
  message:       AgentMessage
  onThreadClick: (t: any) => void
}) {
  const [showThreads,  setShowThreads]  = useState(false)
  const [showActions,  setShowActions]  = useState(true)
  const [showTimeline, setShowTimeline] = useState(false)

  return (
    <div className="space-y-4">
      {/* Main text */}
      <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
        {message.content}
      </div>

      {/* Emails analyzed */}
      {(message.threads?.length ?? 0) > 0 && (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowThreads(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" />
              {message.threads?.length} emails analyzed
            </span>
            {showThreads
              ? <ChevronUp className="w-3.5 h-3.5" />
              : <ChevronDown className="w-3.5 h-3.5" />
            }
          </button>
          {showThreads && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {message.threads?.map((t, i) => (
                <button
                  key={i}
                  onClick={() => onThreadClick(t)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                    {t.subject || '(No subject)'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {t.from} · {t.messageCount} msgs
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action items */}
      {message.action_items?.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowActions(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <CheckSquare className="w-3.5 h-3.5" />
              {message.action_items.length} action items
            </span>
            {showActions
              ? <ChevronUp className="w-3.5 h-3.5" />
              : <ChevronDown className="w-3.5 h-3.5" />
            }
          </button>
          {showActions && (
            <div className="p-3 space-y-2">
              {message.action_items.map((item: ActionItem, i: number) => (
                <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                  <div className={cn(
                    'w-1.5 h-1.5 rounded-full mt-1.5 shrink-0',
                    item.priority === 'high'   ? 'bg-red-500'
                    : item.priority === 'medium' ? 'bg-amber-500'
                    : 'bg-green-500'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {item.task}
                    </p>
                    {(item.owner || item.due_date) && (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {item.owner    && `👤 ${item.owner}`}
                        {item.owner && item.due_date && ' · '}
                        {item.due_date && `📅 ${item.due_date}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {message.timeline?.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowTimeline(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" />
              Timeline ({message.timeline.length} events)
            </span>
            {showTimeline
              ? <ChevronUp className="w-3.5 h-3.5" />
              : <ChevronDown className="w-3.5 h-3.5" />
            }
          </button>
          {showTimeline && (
            <div className="p-4 space-y-3">
              {[...message.timeline]
                .sort((a: TimelineEvent, b: TimelineEvent) =>
                  new Date(a.date).getTime() - new Date(b.date).getTime()
                )
                .map((ev: TimelineEvent, i: number) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {ev.description}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {ev.date}
                        {ev.from_email && ` · ${ev.from_email}`}
                      </p>
                    </div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ───────────────────────────────────
export default function AgentPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  const [conversations,  setConversations]  = useState<AgentConversation[]>([])
  const [currentConvId,  setCurrentConvId]  = useState<string | null>(null)
  const [messages,       setMessages]       = useState<AgentMessage[]>([])
  const [inputQuery,     setInputQuery]     = useState('')
  const [isLoading,      setIsLoading]      = useState(false)
  const [selectedThread, setSelectedThread] = useState<any | null>(null)
  const [showFilters,    setShowFilters]    = useState(false)
  const [filters, setFilters] = useState({ from: '', dateFrom: '', dateTo: '' })

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  useEffect(() => {
    if (session) fetchConversations()
  }, [session])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const fetchConversations = useCallback(async () => {
    const res  = await fetch('/api/agent/conversations')
    const data = await res.json()
    setConversations(data.conversations ?? [])
  }, [])

  async function loadConversation(id: string) {
    setCurrentConvId(id)
    setSelectedThread(null)
    const res  = await fetch(`/api/agent/conversations/${id}`)
    const data = await res.json()
    setMessages(data.messages ?? [])
  }

  function startNewConversation() {
    setCurrentConvId(null)
    setMessages([])
    setInputQuery('')
    setSelectedThread(null)
    inputRef.current?.focus()
  }

  async function deleteConversation(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await fetch(`/api/agent/conversations/${id}`, { method: 'DELETE' })
    setConversations(prev => prev.filter(c => c.id !== id))
    if (currentConvId === id) startNewConversation()
  }

  async function handleSend() {
    if (!inputQuery.trim() || isLoading) return
    const query = inputQuery.trim()
    setInputQuery('')
    setIsLoading(true)

    const tempId = 'temp-' + Date.now()
    const tempMsg: AgentMessage = {
      id: tempId, conversation_id: currentConvId ?? '',
      role: 'user', content: query,
      threads_fetched: 0, threads_analyzed: 0,
      action_items: [], timeline: [],
      thread_ids: [], tokens_used: 0,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempMsg])

    try {
      const res = await fetch('/api/agent/query', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, conversation_id: currentConvId, filters }),
      })
      const data = await res.json()

      if (!currentConvId) {
        setCurrentConvId(data.conversation_id)
        fetchConversations()
      }

      const assistantMsg: AgentMessage = {
        id:               data.message_id ?? 'a-' + Date.now(),
        conversation_id:  data.conversation_id,
        role:             'assistant',
        content:          data.response,
        threads_fetched:  data.threads_fetched ?? 0,
        threads_analyzed: data.threads_fetched ?? 0,
        action_items:     data.action_items ?? [],
        timeline:         data.timeline ?? [],
        thread_ids:       [],
        tokens_used:      0,
        created_at:       new Date().toISOString(),
        threads:          data.threads ?? [],
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch {
      // keep the user message, show error as assistant reply
      setMessages(prev => [...prev, {
        id:               'err-' + Date.now(),
        conversation_id:  currentConvId ?? '',
        role:             'assistant' as const,
        content:          'Something went wrong. Please try again.',
        threads_fetched:  0, threads_analyzed: 0,
        action_items:     [], timeline: [],
        thread_ids:       [], tokens_used: 0,
        created_at:       new Date().toISOString(),
      }])
    }
    setIsLoading(false)
  }

  if (status === 'loading' || !session) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const EXAMPLES = [
    'What is the current status of the Infosys project?',
    'Any pending deliverables from the client this week?',
    'What did the client say about the API integration?',
    'Show all communication with team@company.com',
  ]

  return (
    <>
      <Header title="Agent" subtitle="Project Intelligence" />
      <div className="flex" style={{ height: 'calc(100vh - 4rem)' }}>

        {/* ── Left: Conversations ─────────────── */}
        <aside className="w-64 border-r flex flex-col border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 shrink-0">
          <div className="p-3 border-b border-slate-200 dark:border-slate-700">
            <button
              onClick={startNewConversation}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Query
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => loadConversation(conv.id)}
                className={cn(
                  'group w-full text-left px-3 py-2.5',
                  'rounded-xl cursor-pointer transition-colors',
                  'flex items-start justify-between gap-2',
                  currentConvId === conv.id
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-sm truncate font-medium leading-tight',
                    currentConvId === conv.id
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-slate-700 dark:text-slate-300'
                  )}>
                    {conv.title}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true })}
                  </p>
                </div>
                <button
                  onClick={e => deleteConversation(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-8 px-4 leading-relaxed">
                No queries yet.<br />
                Start by asking about a project.
              </p>
            )}
          </div>
        </aside>

        {/* ── Center: Chat ────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center max-w-lg mx-auto">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-6 shadow-lg shadow-blue-500/30">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
                  Project Intelligence Agent
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                  Ask me about any project, client, or topic.
                  I&apos;ll search across your team&apos;s emails and give you a complete status update.
                </p>
                <div className="grid gap-2 w-full">
                  {EXAMPLES.map(ex => (
                    <button
                      key={ex}
                      onClick={() => setInputQuery(ex)}
                      className="text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full shrink-0 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mt-1">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className={cn(
                  'rounded-2xl',
                  msg.role === 'user'
                    ? 'max-w-[70%] bg-blue-600 text-white px-4 py-3'
                    : 'flex-1 max-w-[85%] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-5 py-4 space-y-4'
                )}>
                  {msg.role === 'user' ? (
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                  ) : (
                    <AssistantMessage message={msg} onThreadClick={setSelectedThread} />
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full shrink-0 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="w-2 h-2 rounded-full bg-blue-500 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-slate-400">
                      Searching emails and analyzing...
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-white dark:bg-slate-900/50">

            {showFilters && (
              <div className="flex gap-2 flex-wrap p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                <input
                  type="text"
                  placeholder="From email..."
                  value={filters.from}
                  onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                />
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                />
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                />
                <button
                  onClick={() => setFilters({ from: '', dateFrom: '', dateTo: '' })}
                  className="text-xs text-slate-400 hover:text-slate-600 px-2"
                >
                  Clear
                </button>
              </div>
            )}

            <div className="flex gap-3 items-end">
              <button
                onClick={() => setShowFilters(v => !v)}
                title="Toggle filters"
                className={cn(
                  'p-2.5 rounded-xl border shrink-0 transition-colors',
                  showFilters
                    ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                )}
              >
                <Filter className="w-4 h-4" />
              </button>

              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={inputQuery}
                  onChange={e => setInputQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Ask about a project, client, or topic..."
                  rows={1}
                  className="w-full resize-none px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-blue-600 transition-all"
                  style={{ minHeight: '48px', maxHeight: '120px' }}
                />
              </div>

              <button
                onClick={handleSend}
                disabled={!inputQuery.trim() || isLoading}
                className="p-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-slate-400 text-center">
              Searches across your team&apos;s inboxes · Enter to send · Shift+Enter for new line
            </p>
          </div>
        </main>

        {/* ── Right: Thread detail ─────────────── */}
        {selectedThread && (
          <aside className="w-80 border-l shrink-0 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Email Thread
              </p>
              <button
                onClick={() => setSelectedThread(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-snug">
                {selectedThread.subject || '(No subject)'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {selectedThread.from}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <Clock className="w-3 h-3" />
                {selectedThread.date}
                <span className="ml-1">· {selectedThread.messageCount} messages</span>
              </div>
              <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
                  {selectedThread.snippet}
                </p>
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-700">
              <a
                href={selectedThread.gmailLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Open in Gmail
              </a>
            </div>
          </aside>
        )}
      </div>
    </>
  )
}
