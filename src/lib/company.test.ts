import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  inviteErrorMessage,
  isCompanyFrozen,
  trekRow,
  type CompanyStatus,
  type TrekInput,
} from './company'

/**
 * company.ts is ~1,100 lines, but almost all of it is Supabase I/O whose real
 * behaviour is the RLS policy on the other end — mocking the client would only
 * assert that the mock was called, which is why that surface is covered by
 * tests/db/ against a real Postgres instead.
 *
 * What is left here is the logic that is genuinely local, and each piece of it
 * guards something: which company can be edited, which fields a save writes,
 * and which database error text is allowed to reach a user's screen.
 */

const baseTrek: TrekInput = {
  title: '  Ridge Walk  ',
  description: 'A sunny ridge traverse',
  location: 'Manali',
  difficulty: 'Moderate',
  distanceKm: 12,
  durationHours: 6,
  meetingPoint: 'Old Bus Stand',
  meetingPoint2: '',
  estimatedCost: 2000,
  maxParticipants: 10,
  gearChecklist: ['boots', 'headlamp'],
}

describe('isCompanyFrozen', () => {
  // Mirrors is_company_writable() in the DB. If the two ever disagree, the
  // dashboard offers a button that RLS then silently refuses — the failure is
  // invisible, which is the worst kind. tests/db/tenant-boundaries.test.ts pins
  // the database side of the same rule.
  const cases: [CompanyStatus, boolean][] = [
    ['pending', false],
    ['approved', false],
    ['rejected', true],
    ['suspended', true],
  ]

  it.each(cases)('%s → frozen: %s', (status, frozen) => {
    expect(isCompanyFrozen(status)).toBe(frozen)
  })

  it('treats pending as writable, matching the DB', () => {
    // Called out separately because it is the counter-intuitive one: an
    // applicant sets its company up while waiting for review. Flipping this to
    // `true` would look like tightening security and would instead break
    // onboarding.
    expect(isCompanyFrozen('pending')).toBe(false)
  })
})

describe('trekRow', () => {
  it('trims the title', () => {
    expect(trekRow(baseTrek).title).toBe('Ridge Walk')
  })

  it('maps camelCase input onto snake_case columns', () => {
    expect(trekRow(baseTrek)).toMatchObject({
      distance_km: 12,
      duration_hours: 6,
      meeting_point: 'Old Bus Stand',
      estimated_cost: 2000,
      max_participants: 10,
      gear_checklist: ['boots', 'headlamp'],
    })
  })

  it('converts empty optional text to null rather than empty string', () => {
    const row = trekRow({ ...baseTrek, description: '', location: '', meetingPoint2: '' })
    expect(row.description).toBeNull()
    expect(row.location).toBeNull()
    expect(row.meeting_point2).toBeNull()
  })

  it('preserves a numeric zero instead of nulling it', () => {
    // The text fields use `|| null`, which would turn 0 into null. The numeric
    // fields deliberately do not, so a free trek stays free rather than
    // becoming "price unknown". This pins that asymmetry.
    const row = trekRow({ ...baseTrek, estimatedCost: 0, distanceKm: 0, maxParticipants: 0 })
    expect(row.estimated_cost).toBe(0)
    expect(row.distance_km).toBe(0)
    expect(row.max_participants).toBe(0)
  })

  it('passes explicit nulls through for numeric fields', () => {
    const row = trekRow({ ...baseTrek, distanceKm: null, estimatedCost: null })
    expect(row.distance_km).toBeNull()
    expect(row.estimated_cost).toBeNull()
  })

  it('omits cover_image_url entirely when the caller did not supply one', () => {
    // The distinction that matters on update: an omitted key leaves the column
    // alone, whereas a present key set to null WIPES the cover image. Both
    // createTrek and updateTrek share this builder, so an edit form that does
    // not touch the image must not blank it.
    expect('cover_image_url' in trekRow(baseTrek)).toBe(false)
  })

  it('includes cover_image_url when explicitly set to null, to clear it', () => {
    const row = trekRow({ ...baseTrek, coverImageUrl: null })
    expect('cover_image_url' in row).toBe(true)
    expect(row.cover_image_url).toBeNull()
  })

  it('includes cover_image_url when set to a value', () => {
    expect(trekRow({ ...baseTrek, coverImageUrl: 'https://cdn/x.jpg' }).cover_image_url).toBe(
      'https://cdn/x.jpg',
    )
  })
})

describe('inviteErrorMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes a known, user-facing error through verbatim', () => {
    const msg = inviteErrorMessage(
      'accepting',
      { message: 'That invitation is no longer valid' },
      'Could not accept invite',
    )
    expect(msg).toBe('That invitation is no longer valid')
  })

  it('replaces an unrecognised database error with the fallback', () => {
    // The security-relevant case, and CLAUDE.md's rule: log the detail, do not
    // put it on screen. A raw Postgres error can carry a constraint name, a
    // column list or a policy name — a free map of the schema for anyone
    // poking at the invite flow.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const msg = inviteErrorMessage(
      'accepting',
      {
        message:
          'duplicate key value violates unique constraint "company_invites_pending_key"',
        code: '23505',
      },
      'Could not accept invite',
    )
    expect(msg).toBe('Could not accept invite')
    expect(msg).not.toContain('company_invites_pending_key')
  })

  it('logs only the unrecognised errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    inviteErrorMessage('accepting', { message: 'Not authenticated' }, 'fallback')
    expect(spy, 'a known outcome should not be logged as an error').not.toHaveBeenCalled()

    inviteErrorMessage('accepting', { message: 'something exploded', code: 'XX000' }, 'fallback')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toContain('XX000')
  })

  it('matches known errors exactly, not by substring', () => {
    // A DB error that merely embeds a known phrase is still an unknown error
    // and must not be forwarded to the user.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const msg = inviteErrorMessage(
      'accepting',
      { message: 'PGRST301: Not authenticated (jwt expired at 2026-08-13T00:00:00Z)' },
      'Please sign in again',
    )
    expect(msg).toBe('Please sign in again')
  })
})
