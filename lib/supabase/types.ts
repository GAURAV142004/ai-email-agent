export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'ignored'
export type TaskPriority = 'high' | 'medium' | 'low'
export type AccountProvider = 'gmail' | 'outlook'
export type AccountStatus = 'active' | 'inactive' | 'error'
export type UserPlan = 'free' | 'pro' | 'enterprise'
export type ReplyStatus = 'replied' | 'pending' | 'overdue' | 'no_reply_needed'

export interface User {
  id: string
  email: string
  name: string | null
  plan: UserPlan
  created_at: string
}

export interface ConnectedAccount {
  id: string
  user_id: string
  provider: AccountProvider
  email: string
  access_token: string | null
  refresh_token: string | null
  watch_expiry: string | null
  last_history_id: string | null
  status: AccountStatus
  created_at: string
}

export interface EmailThread {
  id: string
  user_id: string
  thread_id: string
  subject: string | null
  from_email: string | null
  received_at: string | null
  summary: string | null
  email_link: string | null
  processed_at: string | null
  created_at: string
  // Added in migration 002
  owner_member_id?: string | null
  reply_status?: ReplyStatus | null
  replied_at?: string | null
  response_minutes?: number | null
  pii_was_masked?: boolean
  pii_types_found?: string[]
  // Added in migration 003
  message_count?: number | null
  reply_count?: number | null
  first_replied_at?: string | null
  first_response_minutes?: number | null
  last_replied_at?: string | null
  last_inbound_at?: string | null
  last_outbound_at?: string | null
  awaiting_reply_since?: string | null
  is_resolved?: boolean | null
}

export interface TimelineMessage {
  id: string
  thread_id: string
  direction: 'inbound' | 'outbound'
  from_email: string | null
  from_name: string | null
  snippet: string | null
  sent_at: string | null
  source: 'gmail' | 'app'
  response_minutes: number | null
  message_number: number
  total_messages: number
}

export interface ThreadTreeNode extends TimelineMessage {
  children: ThreadTreeNode[]
  depth: number
}

export interface Task {
  id: string
  thread_id: string | null
  user_id: string
  task: string
  status: TaskStatus
  priority: TaskPriority
  assigned_to: string | null
  due_date: string | null
  follow_up_sent: boolean
  created_at: string
  updated_at: string
  // Joined fields
  email_threads?: EmailThread
}

export interface AiLog {
  id: string
  thread_id: string | null
  user_id: string | null
  prompt: string | null
  response: string | null
  model_used: string | null
  tokens_used: number | null
  created_at: string
}

export interface TeamMember {
  id: string
  email: string
  name: string
  role: string
  avatar_url: string | null
  is_active: boolean
  watch_expiry: string | null
  created_at: string
  supabase_uid?: string | null
  reports_count?: number
  manager_id?: string | null
}

export interface TeamMemberReport {
  id:          string
  member_id:   string
  manager_id:  string
  assigned_at: string
}

export interface ThreadWithMember {
  id: string
  user_id: string
  thread_id: string
  subject: string | null
  from_email: string | null
  received_at: string | null
  summary: string | null
  email_link: string | null
  processed_at: string | null
  created_at: string
  owner_member_id: string | null
  reply_status: ReplyStatus | null
  replied_at: string | null
  response_minutes: number | null
  pii_was_masked: boolean
  pii_types_found: string[]
  // Joined / computed
  owner_name: string
  owner_role: string
  owner_email: string
  owner_avatar_url: string | null
  task_count: number
  pending_task_count: number
  highest_priority: TaskPriority
}

export interface MemberStat {
  id: string
  name: string
  email: string
  role: string
  total_emails: number
  replied_count: number
  pending_count: number
  overdue_count: number
  emails_today: number
  avg_response_minutes: number | null
  fastest_minutes: number | null
  slowest_minutes: number | null
  on_time_pct: number | null
  // Added in migration 003
  total_replies: number           // legacy alias kept for compatibility
  total_replies_sent: number
  app_reply_count: number
  gmail_reply_count: number
  avg_followup_minutes: number | null
  awaiting_reply_count: number
}

export interface StreamStat {
  stream: string
  member_count: number
  emails_today: number
  overdue_count: number
  avg_response_minutes: number | null
}

export interface OverdueThread {
  id: string
  thread_id: string
  subject: string | null
  from_email: string | null
  received_at: string | null
  reply_status: string
  owner_name: string
  owner_role: string
}

export interface AgentConversation {
  id:         string
  member_id:  string
  title:      string
  created_at: string
  updated_at: string
}

export interface ActionItem {
  task:      string
  owner:     string | null
  due_date:  string | null
  priority:  'high' | 'medium' | 'low'
  email_ref: string | null
}

export interface TimelineEvent {
  date:        string
  description: string
  from_email:  string | null
  type:        'sent' | 'received' | 'milestone'
}

export interface AgentMessage {
  id:               string
  conversation_id:  string
  role:             'user' | 'assistant'
  content:          string
  threads_fetched:  number
  threads_analyzed: number
  action_items:     ActionItem[]
  timeline:         TimelineEvent[]
  thread_ids:       string[]
  tokens_used:      number
  created_at:       string
  threads?:         any[]
}

export interface Database {
  public: {
    Tables: {
      users: { Row: User; Insert: Omit<User, 'created_at'>; Update: Partial<User> }
      connected_accounts: { Row: ConnectedAccount; Insert: Omit<ConnectedAccount, 'id' | 'created_at'>; Update: Partial<ConnectedAccount> }
      email_threads: { Row: EmailThread; Insert: Omit<EmailThread, 'id' | 'created_at'>; Update: Partial<EmailThread> }
      tasks: { Row: Task; Insert: Omit<Task, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Task> }
      ai_logs: { Row: AiLog; Insert: Omit<AiLog, 'id' | 'created_at'>; Update: Partial<AiLog> }
    }
  }
}
