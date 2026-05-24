import { getGmailClient } from '@/lib/gmail/client'

/**
 * Downloads a Gmail attachment by its attachmentId and returns the raw bytes.
 * Gmail returns base64url-encoded data — we decode it to a Buffer.
 */
export async function downloadAttachment(
  messageId:    string,
  attachmentId: string,
  accessToken:  string,
  refreshToken?: string,
): Promise<Buffer> {
  const gmail = getGmailClient(accessToken, refreshToken)

  const resp = await gmail.users.messages.attachments.get({
    userId:    'me',
    messageId,
    id:        attachmentId,
  })

  const data = resp.data.data ?? ''
  // Gmail uses base64url encoding (- → +, _ → /)
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}
