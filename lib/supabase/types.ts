// ─── Enums ───────────────────────────────────────────────────────────────────

export type TeamRole =
  | 'delivery_lead'
  | 'senior_ba'
  | 'senior_mis'
  | 'senior_developer'
  | 'ba'
  | 'mis'
  | 'developer'

export type UserPlan = 'free' | 'pro' | 'enterprise'

export type ClassificationRuleType =
  | 'client_domain'
  | 'sender_email'
  | 'receiver_email'
  | 'subject_keyword'
  | 'ai_inference'

export type ClassificationSource = 'rule' | 'ai' | 'both'

export type EmailDirection = 'inbound' | 'outbound' | 'thread'

export type SyncJobStatus = 'pending' | 'running' | 'completed' | 'failed'

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'deferred'

export type TodoPriority = 'high' | 'medium' | 'low'

export type AIPriority = 'high' | 'medium' | 'low'

export type AgentMessageRole = 'user' | 'assistant'

export type AgentResponseType = 'text' | 'table' | 'report' | 'timeline' | 'document'

// ─── Core auth ───────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string | null
  plan: UserPlan
  created_at: string
}

export interface TeamMember {
  id: string
  email: string
  name: string
  role: TeamRole
  avatar_url: string | null
  is_active: boolean
  supabase_uid: string | null
  watch_expiry: string | null
  last_history_id: string | null
  consent_given: boolean
  consent_at: string | null
  consent_ip: string | null
  consent_version: string | null
  created_at: string
}

export interface TeamMemberReport {
  id: string
  member_id: string
  manager_id: string
  assigned_at: string
}

export interface MemberGmailToken {
  member_id: string
  access_token: string
  refresh_token: string | null
  expires_at: string | null
  updated_at: string
}

// ─── Admin configuration ─────────────────────────────────────────────────────

export interface EmailClassificationRule {
  id: string
  rule_type: ClassificationRuleType
  value: string | null
  description: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Knowledge base ──────────────────────────────────────────────────────────

export interface ProjectCluster {
  id: string
  name: string
  description: string | null
  inferred_keywords: string[]
  involved_member_ids: string[]
  kb_entry_count: number
  last_activity_at: string | null
  created_at: string
  updated_at: string
}

export interface KBActionItem {
  task: string
  owner_hint: string | null
  due_date_hint: string | null
}

export interface EmailKnowledgeBase {
  id: string
  owner_member_id: string
  project_cluster_id: string | null
  gmail_thread_id: string
  gmail_message_id: string | null
  summary: string
  key_points: string[]
  action_items: KBActionItem[]
  participant_domains: string[]
  direction: EmailDirection | null
  email_date: string | null
  classification_confidence: number | null
  classification_reason: string | null
  detected_project: string | null
  classification_source: ClassificationSource | null
  pii_was_masked: boolean
  tokens_used: number | null
  created_at: string
  updated_at: string
}

export interface KBSyncJob {
  id: string
  member_id: string | null
  status: SyncJobStatus
  emails_processed: number
  emails_skipped: number
  kb_entries_added: number
  errors: string[]
  started_at: string | null
  completed_at: string | null
  created_at: string
}

// ─── Compliance ──────────────────────────────────────────────────────────────

export interface ComplianceAuditLog {
  id: string
  queried_by: string
  query_text: string
  query_about_member_id: string | null
  was_blocked: boolean
  block_reason: string | null
  personal_topics_found: string[]
  kb_entries_accessed: number
  project_clusters_hit: string[]
  response_type: string | null
  created_at: string
}

// ─── Personal email assistant ─────────────────────────────────────────────────

export interface PersonalInboxEmail {
  id: string
  member_id: string
  gmail_thread_id: string
  gmail_message_id: string
  subject: string | null
  from_email: string | null
  from_name: string | null
  snippet: string | null
  received_at: string | null
  is_read: boolean
  ai_summary: string | null
  ai_priority: AIPriority | null
  is_actionable: boolean
  reply_sent: boolean
  expires_at: string
  created_at: string
}

export interface DailyTodo {
  id: string
  member_id: string
  title: string
  notes: string | null
  status: TodoStatus
  priority: TodoPriority
  due_date: string
  linked_email_id: string | null
  created_at: string
  updated_at: string
  personal_inbox_emails?: PersonalInboxEmail
}

// ─── Chatbot ─────────────────────────────────────────────────────────────────

export interface AgentConversation {
  id: string
  member_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export interface AgentMessage {
  id: string
  conversation_id: string
  role: AgentMessageRole
  content: string
  kb_entries_referenced: number
  project_clusters_referenced: string[]
  response_type: AgentResponseType
  document_filename: string | null
  document_mime_type: string | null
  tokens_used: number | null
  was_blocked: boolean
  block_reason: string | null
  created_at: string
}

// ─── API shapes ───────────────────────────────────────────────────────────────

export interface AgentQueryResponse {
  answer: string
  responseType: AgentResponseType
  projectClusters: string[]
  kbEntriesUsed: number
  wasBlocked: boolean
  blockReason?: string
  documentFilename?: string
  tokensUsed: number
}

export interface ClassificationResult {
  isProjectRelated: boolean
  confidence: number
  reason: string
  detectedProject: string | null
  source: ClassificationSource
}

export interface KBSearchResult {
  entry: EmailKnowledgeBase
  similarity: number
  memberName: string
  memberRole: TeamRole
}

export interface PersonalEmailStats {
  total: number
  unread: number
  actionable: number
  highPriority: number
  replySent: number
}

export interface DailyTodoStats {
  total: number
  pending: number
  inProgress: number
  completed: number
  deferred: number
}
