export function buildEmailAnalysisPrompt(subject: string, threadContent: string): string {
  return `Respond ONLY with valid JSON. Do not wrap in markdown code fences. No explanation before or after the JSON object.

You are an AI assistant that analyzes email threads and extracts actionable tasks.

Analyze the following email thread and respond with ONLY a valid JSON object.
No markdown, no explanation, just raw JSON.

Email Subject: ${subject}

Email Thread:
${threadContent}

Respond with this exact JSON structure:
{
  "summary": "2-3 sentence summary of the email thread",
  "requires_action": true or false,
  "priority": "high" | "medium" | "low",
  "tasks": [
    {
      "task": "Clear, specific action item",
      "priority": "high" | "medium" | "low",
      "due_date": "YYYY-MM-DD or null if not mentioned",
      "assigned_to": "person name/email or null"
    }
  ]
}

Rules:
- requires_action = false if it's a newsletter, notification, or no reply needed
- Extract ALL actionable items as separate task objects
- Be specific in task descriptions — include names, dates, amounts from the email
- Infer due dates from phrases like "by Friday", "end of week", "urgent"
- If no tasks, return empty array []`
}

export function buildFollowUpDraftPrompt(
  subject: string,
  threadContent: string,
  taskDescription: string
): string {
  return `You are a professional email assistant. Draft a concise follow-up email.

Original Subject: ${subject}
Task to follow up on: ${taskDescription}

Original Thread:
${threadContent}

Write a brief, professional follow-up email. Respond with ONLY a JSON object:
{
  "subject": "Re: ${subject}",
  "body": "The email body text here"
}

Keep the tone professional but friendly. Be direct and concise (3-5 sentences max).`
}
