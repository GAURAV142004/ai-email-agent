import nodemailer from 'nodemailer'
import { buildInviteEmail } from './invite-template'

// Create Gmail SMTP transporter
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_SMTP_USER,
      pass: process.env.GMAIL_SMTP_APP_PASSWORD,
    },
  })
}

export async function sendInviteEmail({
  toEmail,
  toName,
  invitedByName,
  role,
}: {
  toEmail:       string
  toName:        string
  invitedByName: string
  role:          string
}): Promise<{ success: boolean; error?: string }> {

  const appName   = process.env.APP_NAME
    ?? 'Email Intelligence Platform'
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL
    ?? ''
  const fromEmail = process.env.GMAIL_SMTP_USER
    ?? 'gauravrpawar1349@gmail.com'

  // Dev mode: SMTP not configured → log to console
  const isDev = !process.env.GMAIL_SMTP_USER ||
    !process.env.GMAIL_SMTP_APP_PASSWORD ||
    process.env.GMAIL_SMTP_APP_PASSWORD === 'your-app-password-here'

  if (isDev) {
    const normalizedAppUrl = appUrl.replace(/\/+$/, '')
    const oauthUrl = `${normalizedAppUrl}/api/auth/signin/google?callbackUrl=${
      encodeURIComponent(`${normalizedAppUrl}/`)
    }`
    console.log('─────────────────────────────────────────')
    console.log('📨 INVITE EMAIL (dev mode — not sent)')
    console.log(`To:   ${toEmail}`)
    console.log(`Name: ${toName}`)
    console.log(`Role: ${role}`)
    console.log(`Link: ${oauthUrl}`)
    console.log('─────────────────────────────────────────')
    return { success: true }
  }

  const { subject, html, text } = buildInviteEmail({
    inviteeName:   toName,
    invitedByName,
    role,
    appName,
    appUrl,
  })

  try {
    const transporter = createTransporter()

    await transporter.sendMail({
      from:    `${appName} <${fromEmail}>`,
      to:      toEmail,
      subject,
      html,
      text,
    })

    return { success: true }

  } catch (err) {
    console.error('Invite email error:',
      err instanceof Error ? err.message : 'Unknown')
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to send',
    }
  }
}
