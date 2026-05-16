import { NextRequest, NextResponse } from 'next/server'
import { getMemberFromSession, getServiceSupabase } from '@/lib/auth'
import { canView } from '@/lib/roles'
import type { TeamRole } from '@/lib/roles'
import type { TimelineMessage, ThreadTreeNode } from '@/lib/supabase/types'

function buildThreadTree(messages: TimelineMessage[]): ThreadTreeNode[] {
  const sorted = [...messages].sort(
    (a, b) =>
      new Date(a.sent_at ?? 0).getTime() - new Date(b.sent_at ?? 0).getTime(),
  )

  const roots: ThreadTreeNode[] = []
  let lastInboundNode:  ThreadTreeNode | null = null
  let lastOutboundNode: ThreadTreeNode | null = null

  for (const msg of sorted) {
    const node: ThreadTreeNode = { ...msg, children: [], depth: 0 }

    if (msg.direction === 'inbound') {
      if (lastOutboundNode) {
        node.depth = lastOutboundNode.depth + 1
        lastOutboundNode.children.push(node)
      } else {
        node.depth = 0
        roots.push(node)
      }
      lastInboundNode  = node
      lastOutboundNode = null
    } else {
      if (lastInboundNode) {
        node.depth = lastInboundNode.depth + 1
        lastInboundNode.children.push(node)
      } else {
        node.depth = 0
        roots.push(node)
      }
      lastOutboundNode = node
      lastInboundNode  = null
    }
  }

  return roots
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const member = await getMemberFromSession()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = getServiceSupabase()

  const { data: thread } = await supabase
    .from('email_threads')
    .select('id, owner_member_id, awaiting_reply_since, owner:team_members!owner_member_id(role)')
    .eq('id', id)
    .single()

  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ownerRole = (thread as any).owner?.role as TeamRole | undefined
  if (ownerRole && !canView(member.role, ownerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: messages } = await supabase
    .from('thread_timeline')
    .select('id, thread_id, direction, from_email, from_name, snippet, sent_at, source, response_minutes, message_number, total_messages')
    .eq('thread_id', id)
    .order('sent_at', { ascending: true })

  const msgs = (messages ?? []) as TimelineMessage[]

  const inboundMsgs   = msgs.filter(m => m.direction === 'inbound')
  const outboundMsgs  = msgs.filter(m => m.direction === 'outbound')
  const responseTimes = outboundMsgs
    .map(m => m.response_minutes)
    .filter((v): v is number => v !== null)

  const avgResponseMinutes = responseTimes.length
    ? Math.round(responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length)
    : null

  const firstInbound  = inboundMsgs[0]
  const firstOutbound = outboundMsgs[0]
  const firstResponseMinutes =
    firstInbound?.sent_at && firstOutbound?.sent_at
      ? Math.max(0, Math.floor(
          (new Date(firstOutbound.sent_at).getTime() - new Date(firstInbound.sent_at).getTime()) / 60_000,
        ))
      : null

  return NextResponse.json({
    messages: msgs,
    tree:     buildThreadTree(msgs),
    summary: {
      totalMessages:        msgs.length,
      inboundCount:         inboundMsgs.length,
      outboundCount:        outboundMsgs.length,
      firstResponseMinutes,
      avgResponseMinutes,
      awaitingReplySince:   (thread as any).awaiting_reply_since ?? null,
    },
  })
}
