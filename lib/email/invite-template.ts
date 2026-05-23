export const CONSENT_VERSION = '1.0'

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

  const baseUrl  = (appUrl ?? '').replace(/\/$/, '')
  const loginUrl = `${baseUrl}/login`

  const subject = `You've been invited to ${appName} — Action Required`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:40px auto;padding:0 16px;">

    <div style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:32px 40px;text-align:center;">
        <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0;">
          ${appName}
        </h1>
        <p style="color:rgba(255,255,255,0.8);font-size:14px;margin:8px 0 0;">
          AI-Powered Project Knowledge Base
        </p>
      </div>

      <!-- Body -->
      <div style="padding:40px;">
        <p style="color:#1e293b;font-size:16px;font-weight:600;margin:0 0 8px;">
          Hi ${inviteeName},
        </p>
        <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
          <strong>${invitedByName}</strong> has added you to <strong>${appName}</strong>
          with the role of <strong>${role}</strong>.
        </p>

        <!-- What the system does -->
        <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px;">
          <p style="color:#1e40af;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px;">
            What this system does
          </p>
          <p style="color:#1e40af;font-size:14px;line-height:1.6;margin:0;">
            ${appName} reads your Gmail inbox to extract project-related summaries and
            build a shared knowledge base for your delivery team. It helps everyone stay
            aligned on project progress, pending items, and open issues — without sharing
            actual email content.
          </p>
        </div>

        <!-- Consent section -->
        <div style="background:#fef9ec;border:1px solid #fcd34d;border-radius:10px;padding:20px;margin-bottom:28px;">
          <p style="color:#92400e;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 12px;">
            &#9888; Your Consent is Required
          </p>
          <p style="color:#78350f;font-size:14px;line-height:1.7;margin:0 0 12px;">
            By joining this system, you consent to the following:
          </p>
          <ul style="color:#78350f;font-size:14px;line-height:1.8;margin:0 0 12px;padding-left:20px;">
            <li><strong>Gmail access:</strong> The system will read your Gmail inbox via secure Google OAuth.</li>
            <li><strong>AI processing:</strong> Work-related emails are summarized by an AI model (AWS Bedrock). Raw email content is never stored.</li>
            <li><strong>Project summaries only:</strong> Only project/client/vendor emails are indexed. Personal emails are excluded.</li>
            <li><strong>Shared knowledge base:</strong> Summaries (not raw emails) are accessible to team members based on their role hierarchy.</li>
            <li><strong>Personal inbox:</strong> Your personal emails are used only for your private task list and are automatically deleted after 10 days.</li>
            <li><strong>Data retention:</strong> KB summaries are retained while you are an active team member. You may request deletion at any time.</li>
            <li><strong>Compliance:</strong> All access to team summaries is audit-logged. Personal topics are automatically blocked from team queries.</li>
          </ul>
          <p style="color:#78350f;font-size:13px;line-height:1.6;margin:0;">
            You will be asked to accept these terms when you first sign in.
            If you do not consent, you will not be added to the knowledge base.
            Contact your administrator to withdraw consent at any time.
          </p>
        </div>

        <!-- CTA -->
        <div style="text-align:center;margin-bottom:32px;">
          <a href="${loginUrl}"
            style="display:inline-block;background:#2563eb;color:#ffffff;
              font-size:15px;font-weight:600;text-decoration:none;
              padding:14px 36px;border-radius:10px;">
            Sign In &amp; Review Consent &#8594;
          </a>
        </div>

        <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0;">
          If you weren't expecting this invitation, you can safely ignore this email.
          Contact your team administrator for any questions about data handling.
        </p>
      </div>

      <!-- Footer -->
      <div style="padding:20px 40px;border-top:1px solid #f1f5f9;text-align:center;">
        <p style="color:#cbd5e1;font-size:12px;margin:0;">
          &copy; ${new Date().getFullYear()} ${appName} &middot; Consent Policy v${CONSENT_VERSION}
          &middot; Sent by ${invitedByName}
        </p>
      </div>
    </div>
  </div>
</body>
</html>`

  const text = `
Hi ${inviteeName},

${invitedByName} has added you to ${appName} as a ${role}.

WHAT THIS SYSTEM DOES:
${appName} reads your Gmail inbox to extract project-related summaries and build
a shared knowledge base for your delivery team.

YOUR CONSENT IS REQUIRED:
By joining, you consent to:
- Gmail inbox access via secure Google OAuth
- AI summarization of work-related emails (raw content never stored)
- Project-only indexing (personal emails excluded and deleted after 10 days)
- Role-based summary sharing within your team hierarchy
- Audit logging of all team knowledge base access
- Personal topic blocking in all team queries

You will be asked to accept these terms when you first sign in.

Sign in here to review and accept:
${loginUrl}

If you have questions about data handling, contact your team administrator.

Consent Policy v${CONSENT_VERSION}
— ${appName}
`.trim()

  return { subject, html, text }
}
