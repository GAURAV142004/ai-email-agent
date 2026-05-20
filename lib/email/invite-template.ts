export function buildInviteEmail({
  inviteeName,
  invitedByName,
  role,
  appName,
  appUrl,
}: {
  inviteeName:   string
  invitedByName: string
  role:          string
  appName:       string
  appUrl:        string
}): { subject: string; html: string; text: string } {

  const baseUrl = (appUrl ?? '').replace(/\/$/, '')
  const oauthUrl = `${baseUrl}/api/auth/signin/google` +
    `?callbackUrl=${encodeURIComponent(`${baseUrl}/`)}`

  const subject = `You've been invited to ${appName}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 16px;">

    <!-- Card -->
    <div style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:32px 40px;text-align:center;">
        <div style="width:48px;height:48px;background:rgba(255,255,255,0.15);border-radius:12px;
          display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <span style="font-size:24px;">&#9889;</span>
        </div>
        <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0;letter-spacing:-0.3px;">
          ${appName}
        </h1>
      </div>

      <!-- Body -->
      <div style="padding:40px;">
        <p style="color:#1e293b;font-size:16px;font-weight:600;margin:0 0 8px;">
          Hi ${inviteeName},
        </p>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
          <strong>${invitedByName}</strong> has added you to
          <strong>${appName}</strong> as a
          <strong>${role}</strong>.
        </p>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 32px;">
          To get started, sign in with your Google account and connect
          your Gmail inbox. This takes less than a minute.
        </p>

        <!-- CTA Button -->
        <div style="text-align:center;margin-bottom:32px;">
          <a href="${oauthUrl}"
            style="display:inline-block;background:#2563eb;color:#ffffff;
              font-size:15px;font-weight:600;text-decoration:none;
              padding:14px 32px;border-radius:10px;
              box-shadow:0 4px 12px rgba(37,99,235,0.3);">
            Sign in with Google &#8594;
          </a>
        </div>

        <!-- Steps -->
        <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:24px;">
          <p style="color:#64748b;font-size:13px;font-weight:600;
            text-transform:uppercase;letter-spacing:0.5px;margin:0 0 12px;">
            What happens next
          </p>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <span style="color:#2563eb;font-weight:700;font-size:13px;min-width:20px;">1.</span>
              <span style="color:#475569;font-size:14px;line-height:1.5;">
                Click the button above and sign in with your
                <strong>company Google account</strong>
              </span>
            </div>
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <span style="color:#2563eb;font-weight:700;font-size:13px;min-width:20px;">2.</span>
              <span style="color:#475569;font-size:14px;line-height:1.5;">
                Go to <strong>Settings</strong> and click
                <strong>Activate Email Watch</strong>
              </span>
            </div>
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <span style="color:#2563eb;font-weight:700;font-size:13px;min-width:20px;">3.</span>
              <span style="color:#475569;font-size:14px;line-height:1.5;">
                Your inbox will start syncing automatically
              </span>
            </div>
          </div>
        </div>

        <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0;">
          If you weren't expecting this invitation or have questions,
          contact your team administrator.
        </p>
      </div>

      <!-- Footer -->
      <div style="padding:20px 40px;border-top:1px solid #f1f5f9;text-align:center;">
        <p style="color:#cbd5e1;font-size:12px;margin:0;">
          &copy; ${new Date().getFullYear()} ${appName} &middot; Sent by ${invitedByName}
        </p>
      </div>
    </div>
  </div>
</body>
</html>`

  const text = `
Hi ${inviteeName},

${invitedByName} has added you to ${appName} as a ${role}.

Sign in here to get started:
${oauthUrl}

After signing in, go to Settings and click "Activate Email Watch"
to connect your Gmail inbox.

— ${appName}
`.trim()

  return { subject, html, text }
}
