import { getGmailClient } from './client'

export interface EmailMessage {
  messageId: string
  from: string
  subject: string
  body: string
  date: string
}

export interface EmailThread {
  threadId: string
  subject: string
  fromEmail: string
  receivedAt: string
  messages: EmailMessage[]
  fullText: string
  emailLink: string
}

export interface FetchNewMessagesResult {
  threadIds:    string[]
  newHistoryId: string | null   // latest cursor returned by Gmail — use this to advance last_history_id
}

export async function fetchThread(
  threadId: string,
  accessToken: string,
  refreshToken?: string
): Promise<EmailThread> {
  const gmail = getGmailClient(accessToken, refreshToken)

  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  })

  const messages: EmailMessage[] = []

  for (const message of thread.data.messages ?? []) {
    const headers = message.payload?.headers ?? []
    const from    = headers.find((h) => h.name === 'From')?.value ?? ''
    const subject = headers.find((h) => h.name === 'Subject')?.value ?? '(no subject)'
    const date    = headers.find((h) => h.name === 'Date')?.value ?? ''
    const body    = extractBody(message.payload)
    messages.push({ messageId: message.id ?? '', from, subject, body, date })
  }

  const firstMessage = messages[0]
  const subject      = firstMessage?.subject ?? '(no subject)'
  const fromEmail    = extractEmailAddress(firstMessage?.from ?? '')
  const rawDate      = firstMessage?.date
  const parsedDate   = rawDate ? new Date(rawDate) : null
  const receivedAt   = parsedDate && !isNaN(parsedDate.getTime())
    ? parsedDate.toISOString()
    : new Date().toISOString()

  const fullText = messages
    .map((m) => `From: ${m.from}\nDate: ${m.date}\n\n${m.body}`)
    .join('\n\n---\n\n')

  return {
    threadId,
    subject,
    fromEmail,
    receivedAt,
    messages,
    fullText,
    emailLink: `https://mail.google.com/mail/u/0/#inbox/${threadId}`,
  }
}

/** Fetch thread IDs added since historyId. Also returns the new cursor to advance. */
export async function fetchNewMessages(
  accessToken:  string,
  historyId:    string,
  refreshToken?: string,
): Promise<FetchNewMessagesResult> {
  const gmail = getGmailClient(accessToken, refreshToken)

  const history = await gmail.users.history.list({
    userId:         'me',
    startHistoryId: historyId,
    historyTypes:   ['messageAdded'],
    labelId:        'INBOX',
  })

  const threadIds = new Set<string>()
  for (const record of history.data.history ?? []) {
    for (const msg of record.messagesAdded ?? []) {
      if (msg.message?.threadId) threadIds.add(msg.message.threadId)
    }
  }

  return {
    threadIds:    Array.from(threadIds),
    // historyId from the response = latest cursor; fall back to the input if API omits it
    newHistoryId: history.data.historyId ?? null,
  }
}

/**
 * Bootstrap: fetch recent inbox message thread IDs directly via messages.list.
 * Used when no history cursor exists yet, or for a manual "backfill" sync.
 */
export async function fetchRecentThreadIds(
  accessToken:  string,
  daysBack:     number = 30,
  refreshToken?: string,
  maxResults:   number = 100,
): Promise<string[]> {
  const gmail    = getGmailClient(accessToken, refreshToken)
  const afterEpoch = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000)

  const res = await gmail.users.messages.list({
    userId:     'me',
    q:          `in:inbox after:${afterEpoch}`,
    maxResults,
  })

  const threadIds = new Set<string>()
  for (const msg of res.data.messages ?? []) {
    if (msg.threadId) threadIds.add(msg.threadId)
  }

  return Array.from(threadIds)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractBody(payload: any): string {
  if (!payload) return ''
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8')
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractBody(part)
      if (text) return text
    }
  }
  return ''
}

function extractEmailAddress(from: string): string {
  const match = from.match(/<(.+?)>/)
  return match ? match[1] : from
}
