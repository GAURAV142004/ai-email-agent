'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, X, ExternalLink, Loader2, Clock, Mail } from 'lucide-react'

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
  open:    boolean
  onClose: () => void
}

export function GmailSearchPanel({ open, onClose }: Props) {
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState<GmailSearchResult[]>([])
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)
  const [total,    setTotal]    = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-950">

      {/* Search bar header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 sticky top-0">
        <Search className="w-5 h-5 text-slate-400 shrink-0" />

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSearch()
            if (e.key === 'Escape') onClose()
          }}
          placeholder='Search inbox... e.g. "from:client@co.com proposal"'
          className="flex-1 bg-transparent text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none"
        />

        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setSearched(false) }}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={handleSearch}
          disabled={!query.trim() || loading}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors shrink-0"
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : 'Search'
          }
        </button>

        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        >
          Cancel
        </button>
      </div>

      {/* Search hints */}
      {!searched && !loading && (
        <div className="px-6 py-8 max-w-2xl mx-auto w-full">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-4">
            Search tips
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'From someone', example: 'from:client@company.com' },
              { label: 'To someone',   example: 'to:team@company.com' },
              { label: 'Subject',      example: 'subject:invoice' },
              { label: 'Date range',   example: 'after:2024/01/01 before:2024/12/31' },
              { label: 'Keywords',     example: 'project proposal urgent' },
              { label: 'Combined',     example: 'from:client subject:proposal' },
            ].map(tip => (
              <button
                key={tip.example}
                onClick={() => setQuery(tip.example)}
                className="text-left p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  {tip.label}
                </p>
                <p className="text-sm text-slate-700 dark:text-slate-300 font-mono">
                  {tip.example}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {searched && !loading && (
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Mail className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-base font-medium text-slate-600 dark:text-slate-400">
                No emails found
              </p>
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                Try different search terms
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full px-4 py-2">
              <p className="text-xs text-slate-400 dark:text-slate-500 px-2 py-2">
                About {total.toLocaleString()} results
              </p>
              {results.map(email => (
                <a
                  key={email.id}
                  href={email.gmailLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-4 px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group border-b border-slate-100 dark:border-slate-800/50 last:border-0"
                >
                  {/* Sender avatar */}
                  <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-sm font-semibold text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                    {email.from.charAt(0).toUpperCase()}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {email.from.replace(/<.*>/, '').trim() || email.from}
                      </p>
                      <p className="text-xs text-slate-400 shrink-0 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {email.date
                          ? new Date(email.date).toLocaleDateString('en-IN', {
                              day: 'numeric', month: 'short',
                            })
                          : ''}
                      </p>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 truncate mb-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {email.subject || '(No subject)'}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 line-clamp-1">
                      {email.snippet}
                    </p>
                  </div>

                  <ExternalLink className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 shrink-0 mt-1 transition-colors" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
