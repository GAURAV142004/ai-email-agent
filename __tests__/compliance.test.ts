import { describe, it, expect } from 'vitest'
import { detectPersonalTopics } from '../lib/compliance/topic-detector'
import { checkKBAccess } from '../lib/compliance/access-guard'

describe('Compliance Topic Detector — Personal Identifiers', () => {
  it('detects queries asking for phone numbers', () => {
    const res = detectPersonalTopics("What is Gaurav's phone number?")
    expect(res.hasPersonalTopics).toBe(true)
    expect(res.detectedTopics).toContain('personal_identifiers')
  })

  it('detects queries asking for home address', () => {
    const res = detectPersonalTopics("Give me his home address.")
    expect(res.hasPersonalTopics).toBe(true)
    expect(res.detectedTopics).toContain('personal_identifiers')
  })

  it('detects queries asking for birth date / age', () => {
    const res = detectPersonalTopics("When is their birthday and age?")
    expect(res.hasPersonalTopics).toBe(true)
    expect(res.detectedTopics).toContain('personal_identifiers')
  })

  it('detects queries asking for government identity cards', () => {
    const res = detectPersonalTopics("What is his Aadhaar card number?")
    expect(res.hasPersonalTopics).toBe(true)
    expect(res.detectedTopics).toContain('personal_identifiers')
  })

  it('detects queries asking for bank accounts', () => {
    const res = detectPersonalTopics("Do you have their bank details?")
    expect(res.hasPersonalTopics).toBe(true)
    expect(res.detectedTopics).toContain('personal_identifiers')
  })

  it('detects queries asking for personal emails', () => {
    const res = detectPersonalTopics("What is Gaurav's personal email address?")
    expect(res.hasPersonalTopics).toBe(true)
    expect(res.detectedTopics).toContain('personal_identifiers')
  })

  it('does not block normal project emails or addressing questions', () => {
    const res1 = detectPersonalTopics("We need to address the bug reported by client.")
    expect(res1.hasPersonalTopics).toBe(false)

    const res2 = detectPersonalTopics("Send an email update regarding the dashboard deploy.")
    expect(res2.hasPersonalTopics).toBe(false)
  })
})

describe('Compliance Access Guard — checkKBAccess', () => {
  it('blocks personal queries and provides compliance reasons', () => {
    const check = checkKBAccess({
      viewerRole: 'developer',
      queryText: "What is Gaurav's mobile number?",
    })
    expect(check.allowed).toBe(false)
    expect(check.personalTopicsFound).toContain('personal_identifiers')
    expect(check.blockReason).toContain('personal or sensitive topics')
  })

  it('allows safe project-related queries', () => {
    const check = checkKBAccess({
      viewerRole: 'developer',
      queryText: "What are the core deliverables for the client dashboard?",
    })
    expect(check.allowed).toBe(true)
    expect(check.blockReason).toBeNull()
  })
})
