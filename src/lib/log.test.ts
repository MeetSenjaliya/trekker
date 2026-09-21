import { afterEach, describe, expect, it, vi } from 'vitest'
import { logError, scrubConsoleBreadcrumb } from './log'

/**
 * The invariant both halves of log.ts hold: a Postgres error's `details` —
 * the field that carries the failing row — never reaches console.error, and
 * therefore never reaches a Sentry breadcrumb. Everything else about the
 * error (message, code) still does, or the log is useless.
 */

// What supabase-js hands back for a unique-constraint violation, row included.
class FakePostgrestError extends Error {
  details = 'Key (email)=(maya@example.test) already exists.'
  hint = 'Try a different email.'
  code = '23505'
  constructor() {
    super('duplicate key value violates unique constraint "profiles_email_key"')
    this.name = 'PostgrestError'
  }
}

describe('logError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs the message and code but never the row', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('Error updating profile:', new FakePostgrestError())

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toEqual([
      'Error updating profile:',
      '23505',
      'duplicate key value violates unique constraint "profiles_email_key"',
    ])
    expect(JSON.stringify(spy.mock.calls[0])).not.toContain('maya@example.test')
  })

  it('logs a plain error and a string without a code slot', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('Unexpected:', new TypeError('x is not a function'))
    logError('Unexpected:', 'just text')
    expect(spy.mock.calls).toEqual([
      ['Unexpected:', 'x is not a function'],
      ['Unexpected:', 'just text'],
    ])
  })

  it('does not crash on null or undefined', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('Unexpected:', null)
    logError('Unexpected:', undefined)
    expect(spy.mock.calls).toEqual([
      ['Unexpected:', 'null'],
      ['Unexpected:', 'undefined'],
    ])
  })
})

describe('scrubConsoleBreadcrumb', () => {
  const raw = new FakePostgrestError()

  it('strips details and hint from a console breadcrumb, keeping message and code', () => {
    const out = scrubConsoleBreadcrumb({
      category: 'console',
      level: 'error',
      message: 'Error updating profile: [object Object]',
      data: { arguments: ['Error updating profile:', raw], logger: 'console' },
    })

    const [, scrubbed] = out.data!.arguments as [string, Record<string, unknown>]
    expect(scrubbed).toEqual({
      name: 'PostgrestError',
      code: '23505',
      message: 'duplicate key value violates unique constraint "profiles_email_key"',
    })
    expect(JSON.stringify(out)).not.toContain('maya@example.test')
    expect(JSON.stringify(out)).not.toContain('Try a different email')
    // The server SDK pre-formats arguments into message; it is rebuilt.
    expect(out.message).toContain('Error updating profile:')
    expect(out.message).toContain('23505')
    expect(out.message).not.toContain('maya@example.test')
  })

  it('leaves a console breadcrumb with nothing to strip untouched', () => {
    const crumb = {
      category: 'console',
      level: 'error' as const,
      message: 'Error: 23505 duplicate key',
      data: { arguments: ['Error:', '23505', 'duplicate key'], logger: 'console' },
    }
    expect(scrubConsoleBreadcrumb(crumb)).toBe(crumb)
  })

  it('leaves non-console breadcrumbs alone', () => {
    const crumb = { category: 'fetch', data: { url: '/rest/v1/profiles', details: 'x' } }
    expect(scrubConsoleBreadcrumb(crumb)).toBe(crumb)
  })
})
