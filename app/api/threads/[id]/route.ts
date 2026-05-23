import { NextResponse } from 'next/server'
// This route references tables removed in migration 008.
// Use the new personal inbox and KB agent endpoints instead.
export function GET()    { return NextResponse.json({ error: 'Endpoint removed. See /api/personal/inbox and /api/agent/query.' }, { status: 410 }) }
export function POST()   { return NextResponse.json({ error: 'Endpoint removed. See /api/personal/inbox and /api/agent/query.' }, { status: 410 }) }
export function PATCH()  { return NextResponse.json({ error: 'Endpoint removed.' }, { status: 410 }) }
export function DELETE() { return NextResponse.json({ error: 'Endpoint removed.' }, { status: 410 }) }
