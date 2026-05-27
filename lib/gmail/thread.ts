import { getGmailClient } from './client'

export interface EmailMessage {
  messageId: string
  from: string
  subject: string
  body: string
  date: string
}

export interface AttachmentMeta {
  messageId:    string
  attachmentId: string
  filename:     string
  mimeType:     string
  sizeBytes:    number
}

export interface EmailThread {
  threadId:    string
  subject:     string
  fromEmail:   string
  toEmails:    string[]    // Primary recipients (To: header, first message)
  ccEmails:    string[]    // CC recipients (Cc: header, first message)
  receivedAt:  string
  messages:    EmailMessage[]
  fullText:    string
  emailLink:   string
  attachments: AttachmentMeta[]
}

export interface FetchNewMessagesResult {
  threadIds:    string[]
  newHistoryId: string | null
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

  const messages:    EmailMessage[]   = []
  const attachments: AttachmentMeta[] = []
  let   toEmails:   string[] = []
  let   ccEmails:   string[] = []

  for (const [msgIndex, message] of (thread.data.messages ?? []).entries()) {
    const headers = message.payload?.headers ?? []
    const from    = headers.find((h) => h.name === 'From')?.value ?? ''
    const subject = headers.find((h) => h.name === 'Subject')?.value ?? '(no subject)'
    const date    = headers.find((h) => h.name === 'Date')?.value ?? ''
    const body    = extractBody(message.payload)
    messages.push({ messageId: message.id ?? '', from, subject, body, date })
    extractAttachmentMeta(message.id ?? '', message.payload, attachments)

    // Extract To/CC from the FIRST message only (thread originator)
    if (msgIndex === 0) {
      const toHeader = headers.find((h) => h.name === 'To')?.value ?? ''
      const ccHeader = headers.find((h) => h.name === 'Cc')?.value ?? ''
      toEmails = parseEmailList(toHeader)
      ccEmails = parseEmailList(ccHeader)
    }
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
    toEmails,
    ccEmails,
    receivedAt,
    messages,
    fullText,
    emailLink:   `https://mail.google.com/mail/u/0/#inbox/${threadId}`,
    attachments,
  }
}

/**
 * Fetch thread IDs added since historyId.
 * Paginates through ALL history pages so no messages are silently dropped.
 */
export async function fetchNewMessages(
  accessToken:   string,
  historyId:     string,
  refreshToken?: string,
): Promise<FetchNewMessagesResult> {
  const gmail = getGmailClient(accessToken, refreshToken)

  const threadIds      = new Set<string>()
  let   latestHistoryId: string | null = null
  let   pageToken:       string | undefined

  do {
    const history = await gmail.users.history.list({
      userId:         'me',
      startHistoryId: historyId,
      historyTypes:   ['messageAdded'],
      labelId:        'INBOX',
      maxResults:     500,
      ...(pageToken ? { pageToken } : {}),
    })

    for (const record of history.data.history ?? []) {
      for (const msg of record.messagesAdded ?? []) {
        if (msg.message?.threadId) threadIds.add(msg.message.threadId)
      }
    }

    if (history.data.historyId) latestHistoryId = history.data.historyId
    pageToken = (history.data.nextPageToken as string | undefined)

  } while (pageToken)

  return {
    threadIds:    Array.from(threadIds),
    newHistoryId: latestHistoryId,
  }
}

/**
 * Bootstrap: fetch recent inbox thread IDs.
 * Paginates through ALL pages so the full date range is covered regardless of volume.
 * Gmail API returns at most 500 per page — we loop until nextPageToken is absent.
 */
export async function fetchRecentThreadIds(
  accessToken:   string,
  daysBack:      number = 30,
  refreshToken?: string,
  maxResults:    number = 500,
): Promise<string[]> {
  const gmail      = getGmailClient(accessToken, refreshToken)
  const afterEpoch = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000)

  const threadIds = new Set<string>()
  let   pageToken: string | undefined

  do {
    const res = await gmail.users.messages.list({
      userId:     'me',
      q:          `in:inbox after:${afterEpoch}`,
      maxResults: 500,           // Gmail API max per page
      ...(pageToken ? { pageToken } : {}),
    })

    for (const msg of res.data.messages ?? []) {
      if (msg.threadId) threadIds.add(msg.threadId)
    }

    pageToken = (res.data.nextPageToken as string | undefined)

    // Stop early if caller-specified cap reached
    if (threadIds.size >= maxResults) break

  } while (pageToken)

  return Array.from(threadIds).slice(0, maxResults)
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

function extractAttachmentMeta(
  messageId: string,
  payload:   any,
  results:   AttachmentMeta[],
): void {
  if (!payload) return

  const attachmentId = payload.body?.attachmentId
  const filename     = payload.filename

  if (attachmentId && filename) {
    results.push({
      messageId,
      attachmentId,
      filename,
      mimeType:  payload.mimeType ?? 'application/octet-stream',
      sizeBytes: payload.body?.size ?? 0,
    })
  }

  for (const part of payload.parts ?? []) {
    extractAttachmentMeta(messageId, part, results)
  }
}

function extractEmailAddress(from: string): string {
  const match = from.match(/<(.+?)>/)
  return match ? match[1] : from
}

/**
 * Parses a comma-separated email header value into an array of lowercase
 * email addresses. Handles both plain addresses and "Name <email>" format.
 *
 * Example input:  "Alice <alice@co.com>, bob@co.com"
 * Example output: ["alice@co.com", "bob@co.com"]
 */
export function parseEmailList(header: string): string[] {
  if (!header.trim()) return []
  return header
    .split(',')
    .map(part => {
      const match = part.match(/<([^>]+)>/)
      return match ? match[1].toLowerCase().trim() : part.toLowerCase().trim()
    })
    .filter(addr => addr.includes('@'))   // must look like an email address
}
