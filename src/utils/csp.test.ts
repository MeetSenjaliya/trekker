import { describe, expect, it } from 'vitest'
import { buildCsp, cspHeaderName } from './csp'

/**
 * The point of the policy is the absence of one keyword. A directive list is
 * easy to reorder by accident and impossible to eyeball in a header dump, so
 * the two properties that make it worth having a nonce at all are pinned here.
 */
describe('buildCsp', () => {
  const scriptSrc = (csp: string) =>
    csp.split('; ').find((d) => d.startsWith('script-src '))!

  it('carries the nonce it was handed, and no inline escape hatch', () => {
    const directive = scriptSrc(buildCsp('deadbeef'))

    expect(directive).toContain(`'nonce-deadbeef'`)
    expect(directive).toContain(`'strict-dynamic'`)
    expect(directive).not.toContain(`'unsafe-inline'`)
    expect(directive).not.toContain(`'unsafe-eval'`)
  })

  it('still lets Emotion and Framer write styles, which a nonce cannot cover', () => {
    expect(buildCsp('deadbeef')).toContain(`style-src 'self' 'unsafe-inline'`)
  })

  it('is report-only until CSP_ENFORCE is set in the environment', () => {
    // Read at module load, as it was in next.config.mjs — the promotion is a
    // redeploy, not a runtime toggle.
    expect(cspHeaderName).toBe(
      process.env.CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    )
  })
})
