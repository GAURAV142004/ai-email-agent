import { describe, it, expect } from 'vitest'
import { maskPII } from '../lib/pii/masker'

// Test 1 — password plain text
describe('Test 1 — password plain text', () => {
  const result = maskPII('please use password: MySecret123 to login')
  it('masked does not contain "MySecret123"', () => expect(result.masked).not.toContain('MySecret123'))
  it('detectedTypes includes "password"',     () => expect(result.detectedTypes).toContain('password'))
  it('itemsRemoved >= 1',                     () => expect(result.itemsRemoved).toBeGreaterThanOrEqual(1))
  it('wasMasked === true',                    () => expect(result.wasMasked).toBe(true))
})

// Test 2 — pwd= variant
describe('Test 2 — pwd= variant', () => {
  const result = maskPII('pwd=abc@123')
  it('masked does not contain "abc@123"',   () => expect(result.masked).not.toContain('abc@123'))
  it('detectedTypes includes "password"',   () => expect(result.detectedTypes).toContain('password'))
})

// Test 3 — API key generic
describe('Test 3 — API key generic', () => {
  const result = maskPII('api_key: abcdef1234567890xyz')
  it('masked does not contain "abcdef1234567890xyz"', () => expect(result.masked).not.toContain('abcdef1234567890xyz'))
  it('detectedTypes includes "api_key"',              () => expect(result.detectedTypes).toContain('api_key'))
})

// Test 4 — OpenAI-style sk- key
// Pattern requires sk- followed by 32+ consecutive alphanumeric chars (no hyphens within key body)
describe('Test 4 — OpenAI-style sk- key', () => {
  const result = maskPII('key is sk-abcdefghijklmnopqrstuvwxyz1234567890abcd')
  it('masked does not contain the raw key', () => expect(result.masked).not.toContain('sk-abcde'))
  it('detectedTypes includes "api_key"',    () => expect(result.detectedTypes).toContain('api_key'))
})

// Test 5 — AWS key
describe('Test 5 — AWS key', () => {
  const result = maskPII('AKIAIOSFODNN7EXAMPLE is the key')
  it('masked does not contain "AKIAIOSFODNN7EXAMPLE"', () => expect(result.masked).not.toContain('AKIAIOSFODNN7EXAMPLE'))
  it('detectedTypes includes "api_key"',               () => expect(result.detectedTypes).toContain('api_key'))
})

// Test 6 — Bearer token
describe('Test 6 — Bearer token', () => {
  const result = maskPII('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.longtoken.sig')
  it('masked does not contain "eyJhbGciOiJIUzI1NiJ9"', () => expect(result.masked).not.toContain('eyJhbGciOiJIUzI1NiJ9'))
  it('detectedTypes includes "token"',                  () => expect(result.detectedTypes).toContain('token'))
})

// Test 7 — Indian mobile number (10 digit)
describe('Test 7 — Indian mobile number (10 digit)', () => {
  const result = maskPII('call me at 9876543210 for help')
  it('masked does not contain "9876543210"', () => expect(result.masked).not.toContain('9876543210'))
  it('detectedTypes includes "phone"',       () => expect(result.detectedTypes).toContain('phone'))
})

// Test 8 — Indian mobile with +91
describe('Test 8 — Indian mobile with +91', () => {
  const result = maskPII('reach me on +91-9876543210')
  it('masked does not contain "9876543210"', () => expect(result.masked).not.toContain('9876543210'))
  it('detectedTypes includes "phone"',       () => expect(result.detectedTypes).toContain('phone'))
})

// Test 9 — Credit card
describe('Test 9 — Credit card', () => {
  const result = maskPII('card number 4111-1111-1111-1111 expiry 12/26')
  it('masked does not contain "4111"',  () => expect(result.masked).not.toContain('4111'))
  it('detectedTypes includes "card"',   () => expect(result.detectedTypes).toContain('card'))
})

// Test 10 — PostgreSQL connection string
describe('Test 10 — PostgreSQL connection string', () => {
  const result = maskPII('db: postgresql://admin:pass@db.internal:5432/prod')
  it('masked does not contain "admin:pass"', () => expect(result.masked).not.toContain('admin:pass'))
  it('detectedTypes includes "conn_str"',    () => expect(result.detectedTypes).toContain('conn_str'))
})

// Test 11 — Aadhaar number
describe('Test 11 — Aadhaar number', () => {
  const result = maskPII('Aadhaar: 1234 5678 9012')
  it('masked does not contain "1234 5678 9012"', () => expect(result.masked).not.toContain('1234 5678 9012'))
  it('detectedTypes includes "aadhaar"',          () => expect(result.detectedTypes).toContain('aadhaar'))
})

// Test 12 — PAN number
describe('Test 12 — PAN number', () => {
  const result = maskPII('PAN card: ABCDE1234F submitted')
  it('masked does not contain "ABCDE1234F"', () => expect(result.masked).not.toContain('ABCDE1234F'))
  it('detectedTypes includes "pan"',         () => expect(result.detectedTypes).toContain('pan'))
})

// Test 13 — Multiple PII types in one email
describe('Test 13 — Multiple PII types in one email', () => {
  const result = maskPII('username=admin password=Test@2024 phone: 9123456780')
  it('detectedTypes includes "username"', () => expect(result.detectedTypes).toContain('username'))
  it('detectedTypes includes "password"', () => expect(result.detectedTypes).toContain('password'))
  it('detectedTypes includes "phone"',    () => expect(result.detectedTypes).toContain('phone'))
  it('itemsRemoved >= 3',                 () => expect(result.itemsRemoved).toBeGreaterThanOrEqual(3))
  it('wasMasked === true',                () => expect(result.wasMasked).toBe(true))
})

// Test 14 — Clean professional email (no PII)
describe('Test 14 — Clean professional email (no PII)', () => {
  const input = 'Hi team, please review the Q3 report and share your feedback by Friday.'
  const result = maskPII(input)
  it('masked === input (string unchanged)', () => expect(result.masked).toBe(input))
  it('itemsRemoved === 0',                  () => expect(result.itemsRemoved).toBe(0))
  it('wasMasked === false',                 () => expect(result.wasMasked).toBe(false))
  it('detectedTypes.length === 0',          () => expect(result.detectedTypes).toHaveLength(0))
})

// Test 15 — maskPII is pure (does not mutate input)
describe('Test 15 — maskPII is pure (does not mutate input)', () => {
  const original = 'password: secret123'
  const input = original
  maskPII(input)
  it('original string is unchanged', () => expect(input).toBe(original))
})

// Test 16 — Empty string input
describe('Test 16 — Empty string input', () => {
  const result = maskPII('')
  it('masked === ""',         () => expect(result.masked).toBe(''))
  it('wasMasked === false',   () => expect(result.wasMasked).toBe(false))
  it('itemsRemoved === 0',    () => expect(result.itemsRemoved).toBe(0))
})

// Test 17 — Secret field
describe('Test 17 — Secret field', () => {
  const result = maskPII('secret=mySecretKey123')
  it('masked does not contain "mySecretKey123"', () => expect(result.masked).not.toContain('mySecretKey123'))
  it('detectedTypes includes "secret"',          () => expect(result.detectedTypes).toContain('secret'))
})
