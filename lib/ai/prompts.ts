export function buildEmailAnalysisPrompt(
  subject: string,
  threadContent: string
): string {
  return `Analyze this business email. Reply with JSON only.

Subject: ${subject}

${threadContent}

JSON:
{
  "summary": "1-2 sentences",
  "requires_action": true|false,
  "priority": "high"|"medium"|"low",
  "tasks": [{"task": "action", "priority": "high"|"medium"|"low", "due_date": "YYYY-MM-DD or null"}]
}

high=urgent/deadline, medium=needs reply, low=fyi.
requires_action=false for automated/newsletter/receipt.`
}

export function buildFollowUpDraftPrompt(
  subject: string,
  threadContent: string,
  instructions?: string
): string {
  return `You are a professional email assistant. Draft a concise follow-up email.

Original Subject: ${subject}${instructions ? `\nInstructions: ${instructions}` : ''}

Original Thread:
${threadContent}

Write a brief, professional follow-up email. Respond with ONLY a JSON object:
{
  "subject": "Re: ${subject}",
  "body": "The email body text here"
}

Keep the tone professional but friendly. Be direct and concise (3-5 sentences max).`
}
