import { NextResponse } from 'next/server'

// This route handled personal email replies which were deprecated in Plan A.
export function GET()    { return NextResponse.json({ error: 'Endpoint removed. Personal inbox feature is deprecated.' }, { status: 410 }) }
export function POST()   { return NextResponse.json({ error: 'Endpoint removed. Personal inbox feature is deprecated.' }, { status: 410 }) }
export function PATCH()  { return NextResponse.json({ error: 'Endpoint removed.' }, { status: 410 }) }
export function DELETE() { return NextResponse.json({ error: 'Endpoint removed.' }, { status: 410 }) }
