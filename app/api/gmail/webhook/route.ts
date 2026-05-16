import { NextRequest, NextResponse } from 'next/server'
import { decodePubSubMessage, processWebhookNotification } from '@/lib/gmail/webhook'

// Google Pub/Sub push endpoint — receives Gmail notifications
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json()
    const notification = decodePubSubMessage(body)

    if (!notification) {
      // Return 200 to acknowledge — Pub/Sub will retry on non-2xx
      return NextResponse.json({ error: 'Invalid message' }, { status: 200 })
    }

    // Process asynchronously (don't await — Pub/Sub expects fast ACK)
    processWebhookNotification(notification).catch((err) => {
      console.error('Webhook processing error:', err)
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Webhook error:', err)
    // Return 200 to prevent Pub/Sub retry storm
    return NextResponse.json({ error: 'Internal error' }, { status: 200 })
  }
}
