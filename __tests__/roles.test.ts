import { describe, it, expect } from 'vitest'
import {
  canView, canReply, hasTeam, getNavItems,
  VISIBILITY_MAP, REPLY_MAP,
  type TeamRole,
} from '../lib/roles'

const ALL_ROLES: TeamRole[] = [
  'delivery_lead', 'senior_ba', 'senior_mis', 'senior_developer',
  'ba', 'mis', 'developer',
]

// ─── canView ────────────────────────────────────────────────────────────────

describe('canView — delivery_lead sees everyone', () => {
  it.each(ALL_ROLES)('canView("delivery_lead", "%s") === true', (role) => {
    expect(canView('delivery_lead', role)).toBe(true)
  })
})

describe('canView — senior_ba', () => {
  it('can view ba', ()        => expect(canView('senior_ba', 'ba')).toBe(true))
  it('cannot view developer', () => expect(canView('senior_ba', 'developer')).toBe(false))
})

describe('canView — senior_mis', () => {
  it('can view mis', ()    => expect(canView('senior_mis', 'mis')).toBe(true))
  it('cannot view ba', () => expect(canView('senior_mis', 'ba')).toBe(false))
})

describe('canView — senior_developer', () => {
  it('can view developer', () => expect(canView('senior_developer', 'developer')).toBe(true))
  it('cannot view mis', ()    => expect(canView('senior_developer', 'mis')).toBe(false))
})

describe('canView — individual contributors see only themselves', () => {
  it('ba can view ba',             () => expect(canView('ba', 'ba')).toBe(true))
  it('ba cannot view developer',   () => expect(canView('ba', 'developer')).toBe(false))
  it('mis can view mis',           () => expect(canView('mis', 'mis')).toBe(true))
  it('developer can view developer', () => expect(canView('developer', 'developer')).toBe(true))
})

// ─── canReply === canView (REPLY_MAP === VISIBILITY_MAP) ─────────────────────

describe('canReply mirrors canView for all combinations', () => {
  for (const viewer of ALL_ROLES) {
    for (const owner of ALL_ROLES) {
      it(`canReply("${viewer}", "${owner}") === canView("${viewer}", "${owner}")`, () => {
        expect(canReply(viewer, owner)).toBe(canView(viewer, owner))
      })
    }
  }

  it('REPLY_MAP is the same reference as VISIBILITY_MAP', () => {
    expect(REPLY_MAP).toBe(VISIBILITY_MAP)
  })
})

// ─── hasTeam ────────────────────────────────────────────────────────────────

describe('hasTeam', () => {
  it('delivery_lead has team',    () => expect(hasTeam('delivery_lead')).toBe(true))
  it('senior_ba has team',        () => expect(hasTeam('senior_ba')).toBe(true))
  it('senior_mis has team',       () => expect(hasTeam('senior_mis')).toBe(true))
  it('senior_developer has team', () => expect(hasTeam('senior_developer')).toBe(true))
  it('ba does not have team',     () => expect(hasTeam('ba')).toBe(false))
  it('mis does not have team',    () => expect(hasTeam('mis')).toBe(false))
  it('developer does not have team', () => expect(hasTeam('developer')).toBe(false))
})

// ─── getNavItems ─────────────────────────────────────────────────────────────

describe('getNavItems', () => {
  it('delivery_lead gets 3 items', () =>
    expect(getNavItems('delivery_lead')).toHaveLength(3))

  it('senior_ba gets 2 items', () =>
    expect(getNavItems('senior_ba')).toHaveLength(2))

  it('senior_mis gets 2 items', () =>
    expect(getNavItems('senior_mis')).toHaveLength(2))

  it('senior_developer gets 2 items', () =>
    expect(getNavItems('senior_developer')).toHaveLength(2))

  it('ba gets 2 items', () =>
    expect(getNavItems('ba')).toHaveLength(2))

  it('mis gets 2 items', () =>
    expect(getNavItems('mis')).toHaveLength(2))

  it('developer gets 2 items', () =>
    expect(getNavItems('developer')).toHaveLength(2))

  it('delivery_lead nav includes /settings/users', () =>
    expect(getNavItems('delivery_lead').map(i => i.href)).toContain('/settings/users'))

  it('all nav variants include /agent and /settings', () => {
    for (const role of ALL_ROLES) {
      const hrefs = getNavItems(role).map(i => i.href)
      expect(hrefs).toContain('/agent')
      expect(hrefs).toContain('/settings')
    }
  })

  it('no nav variants include tasks, team, or monitor', () => {
    for (const role of ALL_ROLES) {
      const hrefs = getNavItems(role).map(i => i.href)
      expect(hrefs).not.toContain('/tasks')
      expect(hrefs).not.toContain('/team')
      expect(hrefs).not.toContain('/monitor')
    }
  })
})
