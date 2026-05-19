'use client'

import {
  Sheet, SheetContent, SheetHeader,
  SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ThreadTree } from './ThreadTree'
import { ResponseBadge } from './ResponseBadge'
import {
  MessageSquareReply, Clock,
  User, ExternalLink,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { ThreadWithMember } from '@/lib/supabase/types'

interface ThreadDetailPanelProps {
  thread:  ThreadWithMember | null
  isOpen:  boolean
  onClose: () => void
  onReply: (thread: ThreadWithMember) => void
}

export function ThreadDetailPanel({
  thread,
  isOpen,
  onClose,
  onReply,
}: ThreadDetailPanelProps) {
  if (!thread) return null

  return (
    <Sheet open={isOpen} onOpenChange={o => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:w-[620px] sm:max-w-[620px] flex flex-col p-0 gap-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <SheetTitle className="text-base font-semibold text-slate-900 dark:text-white leading-snug pr-8 line-clamp-2">
            {thread.subject || '(No subject)'}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2 flex-wrap mt-1 text-xs">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <User className="w-3 h-3" />
              {thread.from_email}
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <Clock className="w-3 h-3" />
              {thread.received_at
                ? formatDistanceToNow(new Date(thread.received_at), { addSuffix: true })
                : '—'
              }
            </span>
            <ResponseBadge
              replyStatus={thread.reply_status ?? null}
              receivedAt={thread.received_at ?? null}
              responseMinutes={thread.response_minutes ?? null}
            />
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* AI Summary */}
          {thread.summary && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                AI Summary
              </p>
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-100 dark:border-slate-700">
                {thread.summary}
              </p>
            </div>
          )}

          {/* Open in Gmail link */}
          {thread.from_email && (
            <a
              href={thread.email_link ??
                `https://mail.google.com/mail/u/0/#search/from:${thread.from_email}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-500 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              View in Gmail
            </a>
          )}

          {/* Conversation tree */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
              Conversation
            </p>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <ThreadTree
                threadId={thread.id}
                memberEmail={thread.owner_email}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="default"
            onClick={() => {
              onClose()
              onReply(thread)
            }}
            className="gap-2"
          >
            <MessageSquareReply className="w-4 h-4" />
            Reply to Email
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
