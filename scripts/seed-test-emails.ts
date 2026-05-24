#!/usr/bin/env tsx
/**
 * Injects 7 realistic project email threads into vikas@fristinetech.com's Gmail inbox
 * using Gmail API users.messages.insert (no SMTP — appears in inbox directly).
 *
 * Run: npx tsx scripts/seed-test-emails.ts
 * Requires: .env.local with SUPABASE vars + GOOGLE_CLIENT_ID/SECRET
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'

dotenv.config({ path: '.env.local' })

const RECIPIENT = 'vikas@fristinetech.com'
let _counter = 1

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pastDate(daysAgo: number, hour = 10, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, minute, 0, 0)
  return d.toUTCString()
}

function freshMsgId(): string {
  return `<seed-${Date.now()}-${_counter++}@fristinetech.com>`
}

function buildRFC2822(opts: {
  from: string
  to: string
  subject: string
  date: string
  body: string
  messageId: string
  inReplyTo?: string
  references?: string
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Date: ${opts.date}`,
    `Message-ID: ${opts.messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
  ]
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`)
  if (opts.references) lines.push(`References: ${opts.references}`)
  lines.push('', opts.body)
  return lines.join('\r\n')
}

function b64url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

// ─── Email Thread Definitions ─────────────────────────────────────────────────

interface Email {
  from: string
  subject: string
  daysAgo: number
  hour?: number
  body: string
}

const THREADS: Array<{ project: string; emails: Email[] }> = [
  // ═══════════════════════════════════════════════════════════════════════
  // 1. HEALTHFIRST INSURANCE — Patient Portal Modernisation
  // ═══════════════════════════════════════════════════════════════════════
  {
    project: 'HealthFirst Insurance — Patient Portal Modernisation',
    emails: [
      {
        from: 'Sarah Mitchell <sarah.mitchell@healthfirst.co.uk>',
        subject: 'HealthFirst Patient Portal — Kickoff Recap & Action Items',
        daysAgo: 28,
        hour: 9,
        body: `Hi Vikas,

Thank you for running today's kickoff — the team was very engaged and I think we're off to a strong start.

Summary of agreed action items from the kickoff session:

ACTION ITEMS:
1. Vikas / Fristine Tech — Finalise technical architecture document by 9 May
2. Priya Sharma (BA) — Schedule stakeholder interviews with claims department by 2 May
3. HealthFirst IT — Provide VPN access credentials to Fristine dev team by 28 April
4. Rahul Mehta (Dev) — Stand up dev environment, share access URL by 3 May

AGREED SCOPE (Phase 1):
- Patient registration & login portal (SSO via NHS Identity Provider)
- Claims submission module with document upload (max 20MB, PDF/JPG/PNG)
- Real-time claim status tracker
- Secure messaging between patient and case handler

TECH STACK AGREED:
- Frontend: Next.js 14 + TypeScript
- Backend API: FastAPI (Python 3.11)
- Database: PostgreSQL 15 (HealthFirst private cloud)
- Auth: OpenID Connect via NHS login
- Hosting: HealthFirst internal Kubernetes cluster

TIMELINE:
- Phase 1 go-live target: 15 July 2026
- UAT window: 23 June – 11 July 2026
- Staging freeze: 18 June 2026

Please confirm receipt and any corrections.

Best,
Sarah Mitchell
Project Manager — Digital Transformation
HealthFirst Insurance Ltd
sarah.mitchell@healthfirst.co.uk | +44 20 7946 0312`,
      },
      {
        from: 'Rahul Mehta <rahul.mehta@fristinetech.com>',
        subject: 'RE: HealthFirst Patient Portal — BLOCKER: NHS OIDC Callback Rejected',
        daysAgo: 20,
        hour: 14,
        body: `Hi Sarah,

Cc: Vikas Pawar, Priya Sharma

We have hit a significant blocker on the NHS Identity Provider integration. Escalating immediately as this could impact Phase 1 timeline.

ISSUE:
When we initiate the OIDC auth flow from our dev environment, the NHS IDP rejects the redirect_uri with:
  "redirect_uri_mismatch: The redirect URI in the request did not match a registered URI."

URI we're sending: https://dev-portal.healthfirst-fristine.internal/auth/callback

ROOT CAUSE (suspected):
HealthFirst IT likely registered a different callback URL in the NHS IDP portal. We need either:
  1. The exact redirect_uri that was registered with NHS Digital
  2. OR permission to update the registration with our dev URL

IMPACT:
- Cannot test authentication end-to-end
- Claims submission module depends on auth completion
- Estimated delay: 5–10 days if not resolved by Friday EOD

ALREADY TRIED:
- URL-encoded variants of the callback
- Trailing slash / no trailing slash variants
- HTTP vs HTTPS
- Confirmed client_id is correct (hfi-patient-portal-dev)

Happy to jump on a call with your IT team. Please treat as urgent.

Thanks,
Rahul Mehta
Senior Developer, Fristine Tech`,
      },
      {
        from: 'Sarah Mitchell <sarah.mitchell@healthfirst.co.uk>',
        subject: 'RE: HealthFirst Patient Portal — UAT Round 1 Feedback',
        daysAgo: 12,
        hour: 11,
        body: `Hi Vikas,

Thank you for deploying to UAT on schedule. The claims team have completed Round 1. Consolidated feedback below.

UAT ROUND 1 — 22 test cases run, 5 failed

CRITICAL (must fix before go-live):
[HFUAT-014] Document upload fails for files >8MB despite spec allowing 20MB
  Steps: Upload a 12MB PDF on claim submission page
  Expected: Upload succeeds | Actual: "File too large" at 8MB
  Assigned to: Rahul Mehta | Fix required by: 26 May

[HFUAT-021] Claim status shows "Unknown" for claims submitted before June 2024
  Affects ~40,000 legacy claims — not acceptable for go-live
  Root cause analysis needed from Fristine team

HIGH PRIORITY:
[HFUAT-007] Session timeout at 12 minutes — NHS compliance requires minimum 15 minutes
[HFUAT-019] Mobile: "Submit Claim" button partially hidden on iPhone SE screens

PASSED (notable):
- SSO login flow: Working perfectly across all tested browsers ✓
- New claim submission (small files): Smooth and intuitive ✓
- Email notifications: All 4 notification types working correctly ✓
- Accessibility: Screen reader compatible, WCAG 2.1 AA ✓ — thank you!

NEXT STEPS:
- Fristine team to provide fix ETA for HFUAT-014 and HFUAT-021 by 26 May
- UAT Round 2 scheduled for 30 May – 6 June

Best,
Sarah`,
      },
      {
        from: 'Sarah Mitchell <sarah.mitchell@healthfirst.co.uk>',
        subject: 'HealthFirst Patient Portal — FORMAL GO-LIVE APPROVAL',
        daysAgo: 4,
        hour: 9,
        body: `Hi Vikas,

I am delighted to confirm that HealthFirst leadership has formally approved the Patient Portal for go-live on 15 July 2026. UAT Round 2 passed all 27 test cases with zero critical defects.

SIGN-OFF:
Signed off by: Dr. Amanda Clarke, Chief Digital Officer, HealthFirst Insurance
Date: 20 May 2026
UAT environment: https://uat.healthfirst-portal.co.uk

GO-LIVE PLAN:
14 July 09:00 UTC — Final production deployment
14 July 11:00 UTC — Smoke testing (Fristine + HealthFirst IT jointly)
15 July 06:00 UTC — DNS cutover, portal live for patients
15 July 09:00 UTC — Go-live announcement to 120,000 registered patients

HYPERCARE:
- Fristine Tech to provide 24/7 on-call 15–22 July
- Please confirm Rahul or another senior dev as primary contact
- HealthFirst IT as secondary escalation

OUTSTANDING BEFORE GO-LIVE:
1. Production SSL certificate — provide CN and SANs by 28 May
2. Database backup schedule — weekly full + daily incremental agreed

Excellent work from the entire Fristine team.

Warm regards,
Sarah Mitchell
HealthFirst Insurance Ltd`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 2. TECHNOVA SOLUTIONS — ERP Integration (SAP ↔ Salesforce)
  // ═══════════════════════════════════════════════════════════════════════
  {
    project: 'TechNova Solutions — SAP-Salesforce ERP Integration',
    emails: [
      {
        from: 'David Chen <david.chen@technovasolutions.com>',
        subject: 'TechNova ERP Integration — SOW Signed, Project Kick-Off',
        daysAgo: 35,
        hour: 10,
        body: `Hi Vikas,

The board countersigned the Statement of Work this morning. You'll receive the executed copy from legal by Thursday.

CONFIRMED SCOPE:
- SAP S/4HANA (v2023) ↔ Salesforce CRM (Enterprise Edition)
- Real-time order sync: Salesforce Opportunity → SAP Sales Order (within 60 seconds)
- Inventory availability: SAP Material Management → Salesforce Product Catalog (every 15 min)
- Invoice sync: SAP Billing → Salesforce Opportunity Stage update
- Customer master data: bidirectional, conflict resolution: SAP wins

MIDDLEWARE: MuleSoft Anypoint Platform (TechNova holds existing licence)
TIMELINE: 14 weeks — start 28 April, go-live 28 July 2026
BUDGET: £185,000 fixed price

KEY CONTACTS:
- David Chen (CTO): Architecture decisions, escalations
- Lisa Park (SAP Lead): All SAP-side configuration queries
- Marcus Webb (Salesforce Admin): Salesforce side

FIRST MILESTONE: Integration architecture document from Fristine by 9 May.

David Chen
Chief Technology Officer, TechNova Solutions`,
      },
      {
        from: 'Priya Sharma <priya.sharma@fristinetech.com>',
        subject: 'RE: TechNova ERP Integration — Data Migration Risk — URGENT REVIEW NEEDED',
        daysAgo: 22,
        hour: 15,
        body: `Hi David,

Cc: Vikas Pawar, Lisa Park (SAP)

Following yesterday's data discovery session I need to flag a significant data migration risk.

ISSUE IDENTIFIED:
TechNova's SAP system has ~2.3 million customer records. Of these:
- 340,000 records: duplicate customer IDs across company codes (merged entities)
- 89,000 records: mismatched country codes that will fail SAP-CRM validation
- 12,000 records: null mandatory fields (VAT registration number missing)

IMPACT:
Without a cleansing pass, the initial sync will fail for ~441,000 records (19% of total). Unacceptable for business continuity.

OPTIONS:

Option A — Data cleansing sprint (3 weeks) before integration build
  Pro: Clean foundation, fewer production errors
  Con: Pushes go-live to mid-August
  Additional cost: £22,000

Option B — Proceed with integration, implement error quarantine queue
  Pro: Maintains July go-live
  Con: Business users will see 19% of customers "not in Salesforce" at go-live
  Additional effort: 1.5 weeks for quarantine queue

MY RECOMMENDATION: Option A with a compressed 2-week cleanse if Lisa's SAP team can assist.

Please advise by 16 May to update the project plan.

Priya Sharma
Senior Business Analyst, Fristine Tech`,
      },
      {
        from: 'David Chen <david.chen@technovasolutions.com>',
        subject: 'TechNova ERP — Executive Demo Preparation — 2 June, Manchester HQ',
        daysAgo: 10,
        hour: 8,
        body: `Vikas,

Our CEO James Hartley and the board want to see a live demo before approving final go-live. Date is fixed:
2 June 2026, 14:00–15:00 GMT, boardroom, Manchester HQ.

DEMO REQUIREMENTS:
1. Live order sync: Create a Salesforce Opportunity, show SAP Sales Order appear within 60 seconds
2. Inventory check: Show real-time SAP stock reflected in Salesforce product record
3. Invoice roundtrip: Post SAP invoice, show Salesforce stage update to "Closed Won"

DEMO ENVIRONMENT:
- Use PROD-like sandbox, not dev — James gets confused by "TEST" watermarks
- Use real TechNova product names (sending product master list tomorrow)
- Demonstrate with 1 order, not bulk

DO NOT SHOW:
- Error handling / quarantine queue (board doesn't need to see failure modes)
- Admin/config screens

LOGISTICS:
- Can 2 team members be on-site in Manchester? We'll cover travel and hotel.
- Suggest Rahul drives the technical demo, Priya handles business narrative.
- Confirm names by 28 May for visitor access passes.

Board approved the data cleanse cost — good catch by Priya.

David`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 3. GREENLEAF LOGISTICS — Fleet GPS Tracking System (Dubai)
  // ═══════════════════════════════════════════════════════════════════════
  {
    project: 'GreenLeaf Logistics — Fleet GPS Tracking System',
    emails: [
      {
        from: 'Mohammed Al-Rashid <ops.manager@greenleaflogistics.ae>',
        subject: 'GreenLeaf Fleet Tracker — Technical Specification Approved v1.4',
        daysAgo: 40,
        hour: 11,
        body: `Dear Vikas,

Our operations team and IT department have completed review of the technical specification document (v1.4) submitted on 15 April. I'm pleased to confirm we have no major objections.

APPROVED:
- GPS hardware: Teltonika FMB920 (4G LTE, GNSS, CAN bus interface)
- Update frequency: Every 30 seconds (active journey), every 5 minutes (parked)
- Backend: REST API with WebSocket push for real-time dashboard
- Dashboard: Web + iOS + Android (Flutter)
- Data retention: 18 months online, 5 years archive (UAE regulatory requirement)
- Fleet size: 320 vehicles (26 GreenLeaf-owned, 294 contractor)
- Driver app: Trip start/end, pre-departure vehicle check, delivery confirmation

OPEN ITEMS (need confirmation before sign-off):
1. Geofencing: We need 85 predefined zones (depots, customer sites, border crossings). Can your team import from our ArcGIS shapefiles?
2. Fuel sensors: 47 trucks have Omnicomm fuel sensors. Can the system read this data?

APPROVED BUDGET: AED 2,400,000 fixed price
PROJECT START: 2 May 2026
PHASE 1 GO-LIVE (12 trucks pilot): 30 June 2026
FULL ROLLOUT: 15 September 2026

Please acknowledge and confirm the open items.

Mohammed Al-Rashid
Operations Manager, GreenLeaf Logistics LLC, Dubai`,
      },
      {
        from: 'Anita Desai <anita.desai@fristinetech.com>',
        subject: 'RE: GreenLeaf Fleet Tracker — GPS Hardware Issue at Jebel Ali Depot — CRITICAL',
        daysAgo: 21,
        hour: 9,
        body: `Hi Mohammed,

Cc: Vikas Pawar, Rahul Mehta

Writing to flag a critical issue discovered during the on-site installation pilot (3 vehicles at Jebel Ali depot, week of 12 May).

ISSUE:
Teltonika FMB920 units are experiencing GPS signal acquisition delays of 4–8 minutes in the depot yard. This makes the "vehicle departs" event unreliable for our 30-second tracking requirement.

ROOT CAUSE (confirmed with Teltonika support):
Jebel Ali depot is surrounded by 18m-high shipping container stacks creating a canyon effect. The FMB920's internal patch antenna cannot acquire satellite lock in this environment.

PROPOSED SOLUTION:
External magnetic-mount antenna (Teltonika 003R-00253):
- Mounts on truck roof, clears the container obstruction
- Acquisition time in depot yard: tested at <45 seconds
- Additional cost: AED 180 per unit × 320 units = AED 57,600 total

ALTERNATIVE (if budget is a concern):
Assisted GPS (A-GPS) pre-warm using GSM — no additional hardware, reduces acquisition to ~90 seconds. Acceptable for longer journeys, not ideal for short yard movements.

OUR RECOMMENDATION: External antenna. AED 57,600 avoids unreliable tracking data that would undermine the entire business case for the system.

Please advise by 27 May so we can adjust the procurement order before the next hardware batch ships.

Best regards,
Anita Desai
MIS Analyst, Fristine Tech`,
      },
      {
        from: 'Mohammed Al-Rashid <ops.manager@greenleaflogistics.ae>',
        subject: 'GreenLeaf Fleet Tracker — Pilot Driver App Feedback — Week 1',
        daysAgo: 6,
        hour: 13,
        body: `Dear Vikas,

Our 12 pilot drivers have completed their first week on the GreenLeaf Driver app (v0.4.2). Feedback collected (in Arabic, translated below).

POSITIVE:
- "Trip start/end is easy, even older drivers can use it" — Driver Hassan Al-Amri
- Digital vehicle check replaces paper form — saving 7 minutes per shift
- WhatsApp-style delivery confirmation is intuitive

ISSUES (by priority):

CRITICAL — must fix before pilot expansion:
1. Arabic text displays right-to-left but buttons remain left-to-right — all 12 drivers flagged this, it is confusing for Arabic-first users
2. App crashes on Android 10 when uploading delivery photo >3MB — 4 drivers on older Samsung devices affected

MODERATE:
3. Fuel level reminder notification fires every 2 hours — drivers find it excessive, suggest once daily at shift start
4. Offline sync broken: when drivers lose mobile data between Dubai–Abu Dhabi on E11, the app does not sync correctly on reconnect

MINOR:
5. Preference for Arabic numerals (٠١٢٣) over Western numerals for distance display — cultural preference

Overall sentiment is positive. Operations supervisor Omar said "much better than the WhatsApp groups we use now."

Please share a fix timeline for the critical items.

Mohammed`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 4. METROPLAN CITY COUNCIL — Smart City Dashboard
  // ═══════════════════════════════════════════════════════════════════════
  {
    project: 'MetroPlan City Council — Smart City Dashboard',
    emails: [
      {
        from: 'James Whitfield <j.whitfield@metroplan.gov.uk>',
        subject: 'MetroPlan Smart City Dashboard — Data Privacy & GDPR Requirements',
        daysAgo: 45,
        hour: 10,
        body: `Dear Vikas,

Following our meeting with MetroPlan's Data Protection Officer (Harriet Sims) and legal team on 22 April, I'm writing to confirm the mandatory data privacy requirements Fristine Tech must comply with.

This is a statutory requirement — the system processes CCTV feeds, pedestrian flow data, and traffic sensor data under the UK Data Protection Act 2018 and GDPR Article 6.

MANDATORY REQUIREMENTS:

1. DATA MINIMISATION:
   - All video feeds must be processed at edge (on camera) — raw video must NOT go to the cloud
   - Only anonymised aggregate counts (pedestrian/vehicle) may be stored centrally
   - Retention: 7 days granular data, 2 years daily aggregates

2. LAWFUL BASIS:
   - A Data Protection Impact Assessment (DPIA) must be completed and approved by Harriet's office before go-live
   - Fristine Tech must sign a Data Processing Agreement (DPA) — legal team will draft

3. SECURITY:
   - All data in transit: TLS 1.3 minimum
   - All data at rest: AES-256
   - Penetration test required before go-live (CREST-accredited tester — MetroPlan will arrange)

4. CITIZEN TRANSPARENCY:
   - Public notices required at all sensor locations (MetroPlan's responsibility)

ACTION REQUIRED FROM FRISTINE TECH:
- Confirm in writing you can meet all above requirements by 2 May
- Appoint a named Data Protection contact
- Return signed DPA within 14 days of receipt

Councillor James Whitfield
Chair, Digital Infrastructure Committee, MetroPlan City Council`,
      },
      {
        from: 'Priya Sharma <priya.sharma@fristinetech.com>',
        subject: 'RE: MetroPlan Smart City — Dashboard Design Review — 14 of 16 Approved',
        daysAgo: 25,
        hour: 16,
        body: `Dear Councillor Whitfield,

Thank you for the detailed design review feedback from the committee meeting on 14 May. Summarising outcomes below.

APPROVED AS-IS (14 of 16):
- Real-time traffic flow heatmap (Borough and street-level zoom) ✓
- Air quality index widget (PM2.5, NO2, O3) ✓
- Public transport occupancy (TfL API integration) ✓
- Waste collection schedule and completion tracker ✓
- Emergency incident overlay (MetroPlan Control Room feed) ✓
- Plus 9 additional dashboard modules ✓

CHANGES REQUESTED (2 — must implement before final sign-off):

1. Colour scheme:
   Committee requests MetroPlan brand colours — Navy #003366 and Gold #FFB800 — instead of our proposed blue/orange palette. Designer will update mockups by 22 May.

2. Dual dashboard (Councillor view vs. Public view):
   - Councillor view: All data including incident details (password protected)
   - Public view: Aggregate metrics only, no incident specifics, no addresses
   - Single codebase, permission-based rendering — please confirm feasibility

ADDITIONAL REQUESTS:
- Historical trends: 24-month trend graphs required (was 12-month) — please confirm DB storage impact
- Mobile: Leader of the Council Cllr. Patricia Hughes primarily uses iPad — dashboard must be touch-optimised

NEW SCOPE (change request required):
Environment team has requested a "green space usage" tracker using park gate sensor data. This is outside original scope. Please provide separate cost estimate.

Best regards,
Priya Sharma, Senior BA, Fristine Tech`,
      },
      {
        from: 'James Whitfield <j.whitfield@metroplan.gov.uk>',
        subject: 'MetroPlan Smart City — Oracle Fusion Legacy Integration Issue',
        daysAgo: 11,
        hour: 14,
        body: `Vikas,

I need to flag a serious integration problem. MetroPlan IT attempted to connect the Smart City Dashboard to our Oracle Fusion ERP (waste management and road maintenance modules) and hit a significant obstacle.

THE PROBLEM:
MetroPlan's Oracle Fusion instance is version 21D (2021). The REST API endpoints your team planned to use (Fusion REST API v21.11+) are not available in our version. Our installation is SOAP/XML only.

IMPACT:
- Waste collection completion data cannot be pulled automatically
- Road maintenance work orders cannot be displayed on the dashboard
- Both were specifically requested by the Waste Management Committee (Cllr. Ahmed Nasser's brief)

ORACLE UPGRADE COST: ~£800,000 and 18 months — not feasible for this project.

OPTIONS (as suggested by Rahul):
a) Build a SOAP adapter layer in the dashboard backend — feasible, adds 2–3 weeks development
b) Oracle Fusion exports to SFTP daily as CSV — simpler, but data is 24h delayed
c) MetroPlan IT builds a REST wrapper around SOAP — their estimate: 6 weeks

Given committee timelines (go-live fixed at 1 August for budget review meeting), I favour option (b) as interim with option (a) as the target state. Can Fristine Tech confirm?

James`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 5. STELLAR RETAIL GROUP — E-commerce Platform Relaunch (Shopify Plus)
  // ═══════════════════════════════════════════════════════════════════════
  {
    project: 'Stellar Retail Group — Shopify Plus E-commerce Relaunch',
    emails: [
      {
        from: 'Emma Rodriguez <emma.r@stellarretail.com>',
        subject: 'Stellar Retail E-commerce Relaunch — PLATFORM DECISION: Shopify Plus Selected',
        daysAgo: 38,
        hour: 9,
        body: `Hi Vikas,

After two weeks of evaluation (Shopify Plus vs. Magento 2 vs. custom build) our board has made the final platform decision.

SELECTED: Shopify Plus

RATIONALE:
1. Time-to-market: Shopify Plus relaunch in 12 weeks vs. 24 weeks for Magento custom
2. TCO: 3-year Shopify Plus TCO is 40% lower (no hosting costs, lower ongoing dev)
3. App ecosystem: 6,000+ apps vs. Magento's 4,000 extensions
4. Digital team already has Shopify expertise (2 in-house developers)

The board overruled IT's recommendation of Magento — CFO-driven decision on TCO.

CONFIRMED SCOPE:
- Product catalogue migration: 8,400 SKUs from WooCommerce
- Customer data migration: 180,000 registered accounts
- Custom storefront theme (aligned with Stellar brand refresh)
- Integrations: NetSuite ERP, Klarna (BNPL), Yotpo (reviews), Klaviyo (email marketing)
- B2B portal: Trade account pricing and bulk ordering (Shopify Plus B2B module)

TIMELINE:
Week 1-2: Data migration planning + Shopify store setup
Week 3-8: Theme development + integration builds
Week 9-10: UAT + content population
Week 11: Soft launch (existing customers only)
Week 12: Full public launch — 15 August 2026

Our WooCommerce site processes ~£2.3M/month. A failed launch is not an option.

Emma Rodriguez
Head of Digital, Stellar Retail Group`,
      },
      {
        from: 'Rahul Mehta <rahul.mehta@fristinetech.com>',
        subject: 'RE: Stellar Retail — Klarna Integration BLOCKER — Decision Required',
        daysAgo: 17,
        hour: 11,
        body: `Hi Emma,

Cc: Vikas Pawar, Anita Desai

Flagging a Klarna integration issue that is currently blocking payment testing.

THE PROBLEM:
Klarna's Shopify Plus integration requires "Klarna On-Site Messaging" which requires a specific Shopify checkout extension. That extension (Klarna OSM v2.4) is not compatible with Shopify's new Checkout Extensibility framework — which is mandatory for Plus merchants from 31 August 2026.

In short: standard Klarna integration will BREAK 16 days after our planned launch date.

OPTIONS:

Option 1: Use existing Klarna integration — works on 15 Aug, breaks on 31 Aug
Risk: BNPL stops working 16 days post-launch. Estimated revenue impact: £180,000/month.

Option 2: Build Klarna via their new API-direct approach
Extra cost: £8,500
Extra time: 3 additional weeks → pushes launch to ~5 September

Option 3: Switch to Clearpay (Afterpay) — certified Checkout Extensibility app
Minimal cost, ~1 week integration, maintains 15 August launch date

MY RECOMMENDATION: Option 3 (Clearpay) if your commercial agreement with Klarna allows substitution. If not, Option 2.

Decision needed by 27 May to preserve any timeline.

Rahul Mehta, Senior Developer, Fristine Tech`,
      },
      {
        from: 'Emma Rodriguez <emma.r@stellarretail.com>',
        subject: 'Stellar Retail — Load Test Results — ALL PASSED — Launch Confirmed 15 Aug',
        daysAgo: 5,
        hour: 14,
        body: `Hi Vikas,

Excellent news from yesterday's load test on the Shopify Plus staging environment.

LOAD TEST RESULTS — 19 May 2026:
- Simulated users: 2,500 concurrent (our Black Friday peak is ~1,800)
- Duration: 60 minutes sustained

RESULTS:
- Average page load: 1.2 seconds (target <2s) ✓
- 95th percentile load: 2.8 seconds ✓
- Checkout completion: 3.4 seconds ✓
- Zero 5xx errors during sustained test ✓
- Peak throughput: 1,240 transactions/minute ✓

Auto-scaling activated smoothly at 1,800+ concurrent users. Shopify infrastructure performed well.

MINOR FINDINGS (not blocking):
- Product image lazy loading: 1 second slower on 3G mobile
- Faceted search: 0.8s response (target was 0.5s) — acceptable

LAUNCH CONFIRMED: 15 August 2026

PAYMENT UPDATE: We confirmed Clearpay is an acceptable substitute per our payment services agreement. Klarna contract allows BNPL provider substitution. Rahul's Option 3 was the right call.

Action from Rahul: Production deployment runbook needed by 31 May.

Brilliant work from the entire team.
Emma`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 6. DATABRIDGE ANALYTICS — Snowflake / Looker BI Reporting Suite
  // ═══════════════════════════════════════════════════════════════════════
  {
    project: 'DataBridge Analytics — Snowflake Looker BI Reporting Suite',
    emails: [
      {
        from: 'Raj Patel <raj.patel@databridge.io>',
        subject: 'DataBridge BI Suite — Data Warehouse Star Schema Approved (v2.1)',
        daysAgo: 30,
        hour: 10,
        body: `Hi Vikas,

Our data engineering team has reviewed the proposed star schema design for the DataBridge BI Reporting Suite and approved it with the following notes.

APPROVED SCHEMA (v2.1):

FACT TABLES:
- fact_sales_transactions (180M rows/year, partition by sale_date)
- fact_customer_interactions (60M rows/year, partition by interaction_date)
- fact_inventory_movements (25M rows/year)

DIMENSION TABLES:
- dim_customer (4.2M records, SCD Type 2 for address/segment changes)
- dim_product (85,000 SKUs)
- dim_geography (country → region → city hierarchy)
- dim_time (standard date spine, fiscal year = April–March)
- dim_sales_channel (online, retail, wholesale, marketplace)

TECH STACK:
- Data warehouse: Snowflake Enterprise tier, EU West region
- ETL: dbt Cloud (DataBridge holds licence)
- BI tool: Looker (native Snowflake connector)
- Data freshness: Daily overnight batch + 30-min Snowpipe for real-time sales

FEEDBACK:
1. SCD Type 2 for dim_customer is correct — Priya was right that we need historical segmentation for cohort analysis.
2. Please add created_at and updated_at columns to all dimension tables — governance team requirement.
3. dim_time fiscal calendar must use UK fiscal year (6 April start) — verify your date spine generator handles this.

TIMELINE CONFIRMED:
- dbt model build: 28 April – 30 May
- Looker LookML development: 2 June – 27 June
- UAT: 30 June – 18 July
- Go-live: 28 July 2026

Raj Patel, Head of Data, DataBridge Analytics`,
      },
      {
        from: 'Raj Patel <raj.patel@databridge.io>',
        subject: 'DataBridge BI Suite — Report Template Review — 14 of 18 Approved',
        daysAgo: 14,
        hour: 15,
        body: `Vikas,

Analytics team has reviewed all 18 Looker report templates submitted on 10 May.

APPROVED (14):
Executive Sales Dashboard (Revenue, Margin, Units KPIs) ✓
Regional Performance Heatmap ✓
Product Category P&L ✓
Customer Cohort Retention (by first purchase month) ✓
Basket Analysis (top 20 product combinations) ✓
Channel Attribution by Revenue ✓
Stock Availability vs. Demand ✓
Daily Sales vs. Target Tracker ✓
Returns Analysis by Category and Reason ✓
Customer Lifetime Value Segmentation ✓
Supplier Performance Scorecard ✓
Promotional Uplift Analysis ✓
B2B Account Revenue Trend ✓
Marketing Campaign ROI ✓

REVISION REQUIRED (4):

15. [FIX] Gross Margin % calculation: you are dividing by net revenue, spec requires gross revenue. Please correct.

16. [FIX] "New vs. Returning Customer" dashboard: definition of "returning" should be >1 purchase in last 12 months, not >1 purchase ever. This significantly changes the metric.

17. [FIX] Inventory Aging: buckets must be 0-30 / 31-60 / 61-90 / 91-180 / 181+ days, not weekly buckets as currently shown.

18. [BLOCKED] Supplier Forecast Accuracy Report — awaiting forecast data format from procurement team. ETA: 2 June.

Please revise #15–17 by 28 May.

Raj`,
      },
      {
        from: 'Raj Patel <raj.patel@databridge.io>',
        subject: 'DataBridge BI Suite — Looker User Training Plan Request',
        daysAgo: 7,
        hour: 11,
        body: `Hi Priya,

Cc: Vikas Pawar

Approaching go-live — we need to agree the training plan for our 45 Looker users across three groups.

GROUP 1: Executive viewers (12 users)
- Needs: View dashboards, export to PDF/Excel, set email schedules
- Looker experience: None
- Format: 90-minute hands-on session (not slides)
- Availability window: Must happen before 14 July (team summer holidays start)

GROUP 2: Analysts (22 users)
- Needs: Build Explores, create custom reports, use table calculations
- Looker experience: Mixed (some have used Tableau or Power BI)
- Format: Half-day workshop + 2-week sandbox access
- Key topics: LookML basics, filters, pivots, table calculations, scheduling

GROUP 3: Data stewards (11 users)
- Needs: Manage user access, maintain dashboards, monitor refresh schedules
- Format: Full-day admin training
- Topics: Looker admin console, PDT rebuilds, Snowflake cost monitoring

QUESTIONS FOR FRISTINE:
1. Will Priya lead training sessions or will you bring in a Looker specialist?
2. Will you provide a training environment with sanitised (non-live) data?
3. Can sessions be recorded for onboarding future staff?
4. What is the cost for an annual Looker admin support retainer?

Please share a training schedule draft by 30 May.

Raj`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 7. NOVACARE PHARMA — 21 CFR Part 11 Drug Compliance Tracker
  // ═══════════════════════════════════════════════════════════════════════
  {
    project: 'NovaCare Pharmaceuticals — Drug Compliance Tracking System (21 CFR Part 11)',
    emails: [
      {
        from: 'Dr. Anita Khanna <a.khanna@novacarepharma.com>',
        subject: 'NovaCare Drug Compliance Tracker — Formal Regulatory Requirements v1.0',
        daysAgo: 42,
        hour: 10,
        body: `Dear Vikas,

Please find below the formal regulatory requirements for the NovaCare Drug Compliance Tracking System. This document supersedes all verbal discussions and must be acknowledged in writing.

REGULATORY FRAMEWORK — system must comply with:
1. FDA 21 CFR Part 11 (Electronic Records and Electronic Signatures)
2. EU GMP Annex 11 (Computerised Systems)
3. ICH Q10 (Pharmaceutical Quality System)
4. MHRA expectations for Computerised System Validation (CSV)

MANDATORY REQUIREMENTS:

A. AUDIT TRAIL (21 CFR Part 11 §11.10(e)):
- Every create/modify/delete on regulated data must be logged
- Log must contain: user ID, timestamp (UTC), action type, old value, new value, record ID
- Audit trail must be UNALTERABLE — no admin or system process may modify or delete it
- Retention: minimum product shelf life + 1 year (typically 7–10 years)

B. ELECTRONIC SIGNATURES (21 CFR Part 11 §11.50):
- All batch release approvals require dual electronic signature (Qualified Person + QA Director)
- Each signer must re-authenticate at point of signing (not just session login)
- System must capture: printed name, date/time, meaning of signature (e.g., "Batch Release Approved")

C. SYSTEM VALIDATION:
- Installation Qualification (IQ), Operational Qualification (OQ), Performance Qualification (PQ) required
- Fristine Tech must provide Validation Master Plan and all qualification protocols for NovaCare QA review
- Go-live requires QA Director sign-off on PQ execution

D. DATA INTEGRITY — ALCOA+ principles required:
- Attributable, Legible, Contemporaneous, Original, Accurate
- Plus: Complete, Consistent, Enduring, Available
- All regulated data stored with checksums, regular verification job required

CRITICAL DEADLINE:
NovaCare is submitting a new drug application (NDA) to FDA by 30 November 2026. Compliance tracker must be live and validated before this date.

Dr. Anita Khanna
Vice President, Quality Assurance, NovaCare Pharmaceuticals`,
      },
      {
        from: 'Rahul Mehta <rahul.mehta@fristinetech.com>',
        subject: 'RE: NovaCare — Audit Trail Technical Design — For QA Review',
        daysAgo: 24,
        hour: 14,
        body: `Dear Dr. Khanna,

Cc: Vikas Pawar, Priya Sharma

Following our review of the 21 CFR Part 11 requirements, sharing our proposed audit trail implementation for your QA team's review.

DATABASE DESIGN:
- Separate audit schema in PostgreSQL 15 with Row Level Security enabled
- audit.event_log table: append-only (REVOKE DELETE, UPDATE privileges at DB role level)
- Fields: id (UUID), timestamp_utc, user_id, user_name, user_role, action_type (CREATE/UPDATE/DELETE), table_name, record_id, old_values (JSONB), new_values (JSONB), row_checksum (SHA-256)
- PostgreSQL trigger fires on every DML on regulated tables, inserts to audit log atomically

IMMUTABILITY:
- audit.event_log has no UPDATE/DELETE triggers
- DB role audit_writer has INSERT permission only — no other DML
- Nightly checksum verification job — any tampered row is flagged and QA Director alerted immediately
- Audit logs replicated in real-time to immutable S3 bucket (Object Lock: Compliance mode, 10-year retention)

ELECTRONIC SIGNATURES:
- Re-authentication at signing: TOTP (Google Authenticator) — independent of session login
- Signature record: signer_name, signer_role, timestamp_utc, action_meaning, document_hash
- Dual signature workflow: system prevents batch release with <2 valid signatures; second signer sees the first signature before countersigning

VALIDATION DELIVERABLES FROM FRISTINE TECH:
- Validation Master Plan (VMP): first draft by 5 June
- IQ Protocol: ready for NovaCare review by 12 June
- OQ/PQ Protocols: by 26 June

This design follows GAMP 5 Category 4 guidelines. Please review with your QA team and confirm or raise concerns.

Rahul Mehta, Senior Developer, Fristine Tech`,
      },
      {
        from: 'Dr. Anita Khanna <a.khanna@novacarepharma.com>',
        subject: 'NovaCare — FDA Review Window Moved to October — ESCALATION TO CEO',
        daysAgo: 15,
        hour: 9,
        body: `Vikas,

Writing directly to you as an urgent escalation. This is now a board-level risk.

SITUATION:
Our regulatory affairs team met with FDA on 12 May. FDA has indicated they will begin review of our NDA pre-submission package on 15 October 2026, not 30 November as planned. This means our compliance tracker must be FULLY VALIDATED AND LIVE by 1 October 2026.

CURRENT PROJECT PLAN COMPLETION: 4 November 2026
REVISED REQUIRED COMPLETION: 1 October 2026
GAP: 34 calendar days

WHAT I NEED FROM FRISTINE TECH (by 23 May):
1. Formal written response on whether the 1 October deadline is achievable
2. If achievable: revised project plan, additional resource requirements, cost impact
3. If not achievable: specific blockers and the earliest possible live date

CONTEXT:
CEO Dr. Ramesh Gupta has been briefed. He has approved any reasonable cost increase to meet October. The NDA represents approximately $2.4 billion in projected revenue over 5 years. Missing the FDA review window is not an option.

I have a call with Dr. Gupta on 24 May. Please respond before then.

Dr. Anita Khanna
VP Quality Assurance, NovaCare Pharmaceuticals
a.khanna@novacarepharma.com | Direct: +1 617 555 0182`,
      },
      {
        from: 'Vikas Pawar <vikas@fristinetech.com>',
        subject: 'RE: NovaCare — Fristine Tech Formal Commitment — 1 October Delivery',
        daysAgo: 14,
        hour: 18,
        body: `Dear Dr. Khanna,

Thank you for the urgent escalation. I've met with the full project team and am writing with our formal response before your call with Dr. Gupta.

FRISTINE TECH'S COMMITMENT: We will deliver a fully validated system by 1 October 2026.

REVISED PLAN:

STAFFING CHANGES (effective 28 May):
- Adding Kiran Joshi (Senior Developer, specialist in PostgreSQL audit systems and 21 CFR Part 11 implementations)
- Priya Sharma dedicated exclusively to NovaCare from 28 May (released from DataBridge project)
- Rahul Mehta: full-time NovaCare with immediate effect

ACCELERATED MILESTONES:
- Core system build complete: 20 June (was 11 July)
- IQ Protocol execution: 23–27 June
- OQ Protocol execution: 30 June – 11 July
- PQ Protocol execution: 14–25 July
- QA Director review & PQ sign-off: 28 July – 8 August
- Defect fixing & revalidation buffer: 11–29 August
- Go-live: 1 September (provides 30-day stabilisation before 1 October FDA review start)

COST IMPACT:
- Additional resource cost: £28,000 (Kiran Joshi contract + overtime premiums)
- No change to fixed-price scope cost
- Please confirm PO amendment from legal

KEY RISK:
The plan assumes no major PQ protocol failures requiring re-execution. If PQ fails on multiple critical tests, we will need an immediate risk discussion. I am confident this is unlikely based on the IQ/OQ evidence from similar validated systems Rahul has delivered.

Rahul is one of the strongest developers I have worked with on compliance-critical systems. We will not let NovaCare down.

Best regards,
Vikas Pawar
Delivery Lead, Fristine Tech
vikas@fristinetech.com`,
      },
    ],
  },
]

// ─── Gmail Injection ──────────────────────────────────────────────────────────

async function getGmailClient(refreshToken: string) {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )
  oauth2.setCredentials({ refresh_token: refreshToken })
  const { credentials } = await oauth2.refreshAccessToken()
  oauth2.setCredentials(credentials)
  return google.gmail({ version: 'v1', auth: oauth2 })
}

async function insertMessage(
  gmail: ReturnType<typeof google.gmail>,
  raw: string,
  threadId?: string,
): Promise<{ id: string; threadId: string }> {
  const res = await gmail.users.messages.insert({
    userId: 'me',
    requestBody: {
      raw: b64url(raw),
      ...(threadId ? { threadId } : {}),
      labelIds: ['INBOX', 'UNREAD'],
    },
  })
  return { id: res.data.id!, threadId: res.data.threadId! }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // Get delivery lead's Gmail refresh token
  const { data: members } = await supabase
    .from('team_members')
    .select('id, email, role')
    .eq('role', 'delivery_lead')
    .eq('is_active', true)
    .limit(1)

  if (!members || members.length === 0) {
    throw new Error('No active delivery_lead found in team_members table')
  }

  const lead = members[0]
  console.log(`Using delivery lead: ${lead.email} (${lead.id})`)

  const { data: tokenRow } = await supabase
    .from('member_gmail_tokens')
    .select('refresh_token')
    .eq('member_id', lead.id)
    .single()

  if (!tokenRow?.refresh_token) {
    throw new Error(`No Gmail refresh token for member ${lead.id}. Have they connected Gmail?`)
  }

  const gmail = await getGmailClient(tokenRow.refresh_token)
  console.log('Gmail client ready. Injecting email threads...\n')

  let totalEmails = 0

  for (const thread of THREADS) {
    console.log(`📁  ${thread.project}`)
    let currentThreadId: string | undefined

    for (let i = 0; i < thread.emails.length; i++) {
      const email = thread.emails[i]
      const msgId = freshMsgId()
      const date = pastDate(email.daysAgo, email.hour ?? 10)
      const subject = email.subject

      const raw = buildRFC2822({
        from: email.from,
        to: RECIPIENT,
        subject,
        date,
        body: email.body,
        messageId: msgId,
      })

      try {
        const result = await insertMessage(gmail, raw, currentThreadId)
        if (i === 0) currentThreadId = result.threadId
        console.log(`  ✓ [${i + 1}/${thread.emails.length}] ${subject.slice(0, 65)}...`)
        totalEmails++

        // Brief pause to avoid rate limiting
        await new Promise(r => setTimeout(r, 300))
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  ✗ Failed to insert email: ${msg}`)
      }
    }

    console.log()
  }

  console.log(`\n✅ Done — ${totalEmails} emails injected into ${RECIPIENT}'s Gmail inbox.`)
  console.log('\nNext steps:')
  console.log('  1. Go to Settings → Knowledge Base → Run Bootstrap (set daysBack ≥ 50)')
  console.log('  2. Wait for sync to complete — all 7 project threads will be indexed')
  console.log('  3. Open the Agent chatbot and test with the sample queries below\n')
  console.log('SAMPLE TEST QUERIES:')
  console.log('  Generic (should trigger clarification): "What did we discuss with the client?"')
  console.log('  Specific: "What are the HealthFirst UAT blockers?"')
  console.log('  Multi-project: "Which projects have upcoming go-live deadlines?"')
  console.log('  Follow-up: "Tell me more about the NovaCare FDA situation"')
  console.log('  Action items: "What action items are outstanding for TechNova?"')
  console.log('  Technical: "What was the GPS hardware issue we hit with GreenLeaf?"')
  console.log('  Risk: "Which projects have payment or integration blockers?"')
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
