'use client'

import { useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { toast } from 'sonner'
import { Loader2, Sparkles, Send, Bold, Italic, UnderlineIcon, List } from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { ThreadWithMember } from '@/lib/supabase/types'

interface ReplyComposerProps {
  thread: ThreadWithMember
  isOpen: boolean
  onClose: () => void
  onReplySent: () => void
}

export function ReplyComposer({ thread, isOpen, onClose, onReplySent }: ReplyComposerProps) {
  const [toEmail]    = useState(thread.from_email ?? '')
  const [subject]    = useState(
    thread.subject?.startsWith('Re:') ? thread.subject : `Re: ${thread.subject ?? ''}`
  )
  const [generating, setGenerating] = useState(false)
  const [sending,    setSending]    = useState(false)

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none min-h-[160px] focus:outline-none px-3 py-2',
      },
    },
  })

  const generateDraft = useCallback(async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadDbId:      thread.id,
          taskDescription: 'Generate a professional follow-up reply based on the email thread context.',
        }),
      })
      if (!res.ok) throw new Error('Draft generation failed')
      const data = await res.json()
      editor?.commands.setContent(`<p>${data.draft.replace(/\n/g, '</p><p>')}</p>`)
    } catch {
      toast.error('Failed to generate draft. Please try again.')
    } finally {
      setGenerating(false)
    }
  }, [thread.id, editor])

  const sendReply = useCallback(async () => {
    const bodyHtml = editor?.getHTML() ?? ''
    if (!bodyHtml || bodyHtml === '<p></p>') {
      toast.error('Reply body cannot be empty.')
      return
    }

    setSending(true)
    try {
      const res = await fetch('/api/gmail/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadDbId:    thread.id,
          gmailThreadId: thread.thread_id,
          toEmail,
          subject,
          bodyHtml,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Send failed')
      }
      toast.success('Reply sent successfully.')
      editor?.commands.clearContent()
      onReplySent()
      onClose()
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to send reply.')
    } finally {
      setSending(false)
    }
  }, [editor, thread.id, thread.thread_id, toEmail, subject, onReplySent, onClose])

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <SheetTitle className="text-sm font-semibold">Reply to Email</SheetTitle>
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">
            {thread.subject ?? '(no subject)'}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* To field */}
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">To</Label>
            <Input
              value={toEmail}
              readOnly
              className="text-sm bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 cursor-default"
            />
          </div>

          {/* Subject field */}
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Subject</Label>
            <Input
              value={subject}
              readOnly
              className="text-sm bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 cursor-default"
            />
          </div>

          {/* Editor */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-slate-500 dark:text-slate-400">Message</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={generateDraft}
                disabled={generating}
                className="h-7 text-xs gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-500/10"
              >
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {generating ? 'Generating…' : 'AI Draft'}
              </Button>
            </div>

            {/* Formatting toolbar */}
            <div className="flex items-center gap-0.5 px-2 py-1.5 border border-b-0 border-slate-200 dark:border-slate-700 rounded-t-lg bg-slate-50 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleBold().run()}
                className={cn(
                  'p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors',
                  editor?.isActive('bold') && 'bg-slate-200 dark:bg-slate-700'
                )}
              >
                <Bold className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                className={cn(
                  'p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors',
                  editor?.isActive('italic') && 'bg-slate-200 dark:bg-slate-700'
                )}
              >
                <Italic className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
                className={cn(
                  'p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors',
                  editor?.isActive('underline') && 'bg-slate-200 dark:bg-slate-700'
                )}
              >
                <UnderlineIcon className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                className={cn(
                  'p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors',
                  editor?.isActive('bulletList') && 'bg-slate-200 dark:bg-slate-700'
                )}
              >
                <List className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>

            <div className="border border-slate-200 dark:border-slate-700 rounded-b-lg bg-white dark:bg-slate-900 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-300 dark:focus-within:border-blue-700 transition-all">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>

        <SheetFooter className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex-row justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={sending}
            className="text-sm border-slate-200 dark:border-slate-700"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={sendReply}
            disabled={sending || generating}
            className="text-sm gap-1.5"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {sending ? 'Sending…' : 'Send Reply'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
