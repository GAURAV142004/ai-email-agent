'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Sheet, SheetContent, SheetHeader,
  SheetTitle, SheetDescription
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search, ExternalLink, Loader2,
  Mail, Clock, MessageSquareReply,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'

interface GmailSearchResult {
  id:        string
  threadId:  string
  subject:   string
  from:      string
  to:        string
  date:      string
  snippet:   string
  gmailLink: string
}

interface Props {
  open:     boolean
  onClose:  () => void
  onReply?: (threadId: string, subject: string, from: string) => void
}

export function GmailSearchPanel({ open, onClose, onReply }: Props) {
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<GmailSearchResult[]>([])
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)
  const [total,    setTotal]    = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150)
      setQuery('')
      setResults([])
      setSearched(false)
    }
  }, [open])

  async function handleSearch() {
    if (!query.trim()) return
    setLoading(true)
    setSearched(false)

    try {
      const params = new URLSearchParams()

      const fromMatch    = query.match(/from:(\S+)/i)
      const toMatch      = query.match(/to:(\S+)/i)
      const subjectMatch = query.match(/subject:(\S+)/i)
      const afterMatch   = query.match(/after:(\S+)/i)
      const beforeMatch  = query.match(/before:(\S+)/i)

      if (fromMatch)    params.set('from',    fromMatch[1])
      if (toMatch)      params.set('to',      toMatch[1])
      if (subjectMatch) params.set('subject', subjectMatch[1])
      if (afterMatch)   params.set('after',   afterMatch[1].replace(/-/g, '/'))
      if (beforeMatch)  params.set('before',  beforeMatch[1].replace(/-/g, '/'))

      const freeText = query
        .replace(/from:\S+/gi, '')
        .replace(/to:\S+/gi, '')
        .replace(/subject:\S+/gi, '')
        .replace(/after:\S+/gi, '')
        .replace(/before:\S+/gi, '')
        .trim()
      if (freeText) params.set('q', freeText)

      const res  = await fetch(`/api/gmail/search?${params}`)
      const data = await res.json()
      setResults(data.emails ?? [])
      setTotal(data.total ?? 0)
    } catch {
      setResults([])
    }
    setLoading(false)
    setSearched(true)
  }

  function getSenderName(from: string): string {
    const match = from.match(/^([^<]+)</)
    return match ? match[1].trim() : from
  }

  function getSenderInitial(from: string): string {
    return getSenderName(from).charAt(0).toUpperCase() || '?'
  }

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:w-[600px] sm:max-w-[600px] flex flex-col p-0 gap-0"
      >
        {/* Header */}
        <SheetHeader className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Search className="w-4 h-4 text-blue-500" />
            Search Gmail Inbox
          </SheetTitle>
          <SheetDescription className="text-xs">
            Search directly in your Gmail.
            Use from:, to:, subject:, after:, before: operators.
          </SheetDescription>
        </SheetHeader>

        {/* Search bar */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder='e.g. "from:client@co.com proposal"'
                className="pl-9 text-sm h-9 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 focus:bg-white dark:focus:bg-slate-900"
              />
            </div>
            <Button
              size="sm"
              onClick={handleSearch}
              disabled={!query.trim() || loading}
              className="h-9 px-4 shrink-0"
            >
              {loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : 'Search'
              }
            </Button>
          </div>

          {/* Quick filter chips */}
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {[
              { label: 'Today',          q: `after:${new Date().toISOString().split('T')[0].replace(/-/g,'/')}` },
              { label: 'Unread',         q: 'is:unread' },
              { label: 'Has attachment', q: 'has:attachment' },
              { label: 'Important',      q: 'is:important' },
            ].map(chip => (
              <button
                key={chip.label}
                onClick={() => {
                  setQuery(chip.q)
                  setTimeout(handleSearch, 100)
                }}
                className={cn(
                  'text-[11px] px-2.5 py-1 rounded-full',
                  'bg-slate-100 dark:bg-slate-800',
                  'text-slate-600 dark:text-slate-400',
                  'hover:bg-blue-50 dark:hover:bg-blue-900/20',
                  'hover:text-blue-600 dark:hover:text-blue-400',
                  'transition-colors border border-slate-200 dark:border-slate-700',
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">

          {/* Empty state */}
          {!searched && !loading && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center mb-4">
                <Search className="w-7 h-7 text-blue-500" />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Search your inbox
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
                Type a name, subject, or use operators like
                <br />
                <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded text-[11px]">
                  from:client@company.com
                </code>
              </p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <p className="text-sm text-slate-400">Searching Gmail...</p>
              </div>
            </div>
          )}

          {/* No results */}
          {searched && !loading && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <Mail className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                No emails found
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Try different search terms
              </p>
            </div>
          )}

          {/* Results list */}
          {searched && !loading && results.length > 0 && (
            <div>
              <p className="px-5 py-2 text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                {results.length} of ~{total.toLocaleString()} results
              </p>
              {results.map(email => (
                <div
                  key={email.id}
                  className="px-4 py-3.5 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full shrink-0 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-semibold mt-0.5">
                      {getSenderInitial(email.from)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate leading-tight">
                          {getSenderName(email.from)}
                        </p>
                        <p className="text-[11px] text-slate-400 shrink-0 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {email.date
                            ? formatDistanceToNow(new Date(email.date), { addSuffix: true })
                            : '—'
                          }
                        </p>
                      </div>

                      <p className="text-sm text-slate-700 dark:text-slate-300 truncate mb-1 font-medium">
                        {email.subject || '(No subject)'}
                      </p>

                      <p className="text-xs text-slate-400 dark:text-slate-500 line-clamp-2 leading-relaxed mb-2.5">
                        {email.snippet}
                      </p>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs px-3 gap-1.5"
                          onClick={() => onReply?.(email.threadId, email.subject, email.from)}
                        >
                          <MessageSquareReply className="w-3 h-3" />
                          Reply
                        </Button>

                        <a
                          href={email.gmailLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 h-7 px-3 rounded-md text-xs border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open in Gmail
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
