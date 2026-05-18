'use client'

import { useState } from 'react'
import { Search, ExternalLink, X } from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface SearchEmail {
  id: string
  threadId: string
  subject: string
  from: string
  to: string
  date: string
  snippet: string
  gmailLink: string
}

interface SearchResult {
  emails: SearchEmail[]
  total: number
  query: string
}

interface GmailSearchPanelProps {
  open: boolean
  onClose: () => void
}

export function GmailSearchPanel({ open, onClose }: GmailSearchPanelProps) {
  const [from,    setFrom]    = useState('')
  const [to,      setTo]      = useState('')
  const [subject, setSubject] = useState('')
  const [after,   setAfter]   = useState('')
  const [before,  setBefore]  = useState('')
  const [q,       setQ]       = useState('')

  const [result,    setResult]    = useState<SearchResult | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const isEmpty = !from && !to && !subject && !after && !before && !q

  async function handleSearch() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (from)    params.set('from',    from)
      if (to)      params.set('to',      to)
      if (subject) params.set('subject', subject)
      if (after)   params.set('after',   after)
      if (before)  params.set('before',  before)
      if (q)       params.set('q',       q)

      const res  = await fetch(`/api/gmail/search?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Search failed')
      setResult(json)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function handleClear() {
    setFrom(''); setTo(''); setSubject('')
    setAfter(''); setBefore(''); setQ('')
    setResult(null); setError(null)
  }

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent side="right" className="w-[520px] max-w-full flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
              <Search className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <SheetTitle className="text-base font-bold text-slate-900 dark:text-white">
                Search Inbox
              </SheetTitle>
              <SheetDescription className="text-xs text-slate-400 mt-0">
                Search directly in Gmail
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Filters */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500 dark:text-slate-400">From email</Label>
              <Input
                placeholder="sender@example.com"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="h-8 text-sm"
                onKeyDown={e => e.key === 'Enter' && !isEmpty && handleSearch()}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500 dark:text-slate-400">To email</Label>
              <Input
                placeholder="recipient@example.com"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="h-8 text-sm"
                onKeyDown={e => e.key === 'Enter' && !isEmpty && handleSearch()}
              />
            </div>
          </div>

          <div className="mb-3 space-y-1">
            <Label className="text-xs text-slate-500 dark:text-slate-400">Subject contains</Label>
            <Input
              placeholder="e.g. Project update"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={e => e.key === 'Enter' && !isEmpty && handleSearch()}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500 dark:text-slate-400">After date</Label>
              <Input
                type="date"
                value={after}
                onChange={e => setAfter(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Before date</Label>
              <Input
                type="date"
                value={before}
                onChange={e => setBefore(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="mb-4 space-y-1">
            <Label className="text-xs text-slate-500 dark:text-slate-400">Keywords</Label>
            <Input
              placeholder="Any Gmail search terms"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={e => e.key === 'Enter' && !isEmpty && handleSearch()}
            />
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-9 text-sm font-semibold rounded-xl"
              onClick={handleSearch}
              disabled={isEmpty || loading}
            >
              {loading ? (
                <Search className="w-3.5 h-3.5 mr-1.5 animate-pulse" />
              ) : (
                <Search className="w-3.5 h-3.5 mr-1.5" />
              )}
              {loading ? 'Searching…' : 'Search'}
            </Button>
            {(result || !isEmpty) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-3 rounded-xl text-slate-500"
                onClick={handleClear}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="px-6 py-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {result && !loading && (
            <>
              <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800">
                <p className="text-xs text-slate-400">
                  {result.total > 0
                    ? `~${result.total.toLocaleString()} results · showing ${result.emails.length}`
                    : 'No results found'}
                  {' '}
                  <span className="font-mono text-slate-300 dark:text-slate-600 text-[10px]">
                    {result.query}
                  </span>
                </p>
              </div>

              <div className="divide-y divide-slate-50 dark:divide-slate-800">
                {result.emails.map(email => (
                  <div
                    key={email.id}
                    className="px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <a
                        href={email.gmailLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 line-clamp-1 flex-1"
                      >
                        {email.subject}
                      </a>
                      <a
                        href={email.gmailLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        aria-label="Open in Gmail"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400 hover:text-blue-500" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1">
                        {email.from}
                      </p>
                      <p className="text-[11px] text-slate-400 shrink-0">
                        {email.date ? new Date(email.date).toLocaleDateString() : ''}
                      </p>
                    </div>
                    {email.snippet && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 line-clamp-2 leading-relaxed">
                        {email.snippet}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {!result && !loading && !error && (
            <div className="px-6 py-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                <Search className="w-6 h-6 text-slate-300 dark:text-slate-600" />
              </div>
              <p className="text-sm text-slate-400">Fill in filters above and press Search</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
