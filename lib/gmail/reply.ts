import { google } from 'googleapis'

export interface SendReplyParams {
  accessToken: string
  refreshToken: string
  gmailThreadId: string
  toEmail: string
  subject: string
  bodyHtml: string
  inReplyToMessageId: string
}

export interface SendReplyResult {
  messageId: string
  threadId: string
}

export async function sendGmailReply(params: SendReplyParams): Promise<SendReplyResult> {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!
  )
  auth.setCredentials({
    access_token:  params.accessToken,
    refresh_token: params.refreshToken,
  })

  const gmail = google.gmail({ version: 'v1', auth })

  const subject = params.subject.startsWith('Re:')
    ? params.subject
    : `Re: ${params.subject}`

  const messageParts = [
    `To: ${params.toEmail}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${params.inReplyToMessageId}`,
    `References: ${params.inReplyToMessageId}`,
    `Content-Type: text/html; charset=utf-8`,
    `MIME-Version: 1.0`,
    ``,
    params.bodyHtml,
  ]

  const raw = Buffer.from(messageParts.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: params.gmailThreadId },
  })

  return {
    messageId: result.data.id!,
    threadId:  result.data.threadId!,
  }
}

export async function getLastMessageId(
  accessToken: string,
  refreshToken: string,
  gmailThreadId: string
): Promise<string | null> {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!
  )
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken })

  const gmail = google.gmail({ version: 'v1', auth })
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: gmailThreadId,
    format: 'METADATA',
    metadataHeaders: ['Message-ID'],
  })

  const messages = thread.data.messages ?? []
  if (messages.length === 0) return null

  const last = messages[messages.length - 1]
  const msgIdHeader = last.payload?.headers?.find(h => h.name === 'Message-ID')
  return msgIdHeader?.value ?? last.id ?? null
}
