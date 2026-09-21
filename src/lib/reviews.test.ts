import { describe, expect, it } from 'vitest';
import { lastTrekDay } from './reviews';

// Same cases as tests/db/review-gate.test.ts, which pins the policy this
// mirrors: the form must not appear on a day the insert would be refused.
describe('lastTrekDay', () => {
  it('is the departure day for a trek with no duration', () => {
    expect(lastTrekDay('2026-09-20', null)).toBe('2026-09-20');
    expect(lastTrekDay('2026-09-20', undefined)).toBe('2026-09-20');
  });

  it('treats a sub-24-hour duration as a single day', () => {
    expect(lastTrekDay('2026-09-20', 2)).toBe('2026-09-20');
    expect(lastTrekDay('2026-09-20', 24)).toBe('2026-09-20');
  });

  it('rounds hours up to whole days', () => {
    expect(lastTrekDay('2026-09-20', 35)).toBe('2026-09-21');
    expect(lastTrekDay('2026-09-20', 72)).toBe('2026-09-22');
  });

  it('crosses month and year boundaries', () => {
    expect(lastTrekDay('2026-12-31', 48)).toBe('2027-01-01');
  });
});
