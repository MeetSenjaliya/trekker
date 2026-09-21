import { describe, expect, it } from 'vitest';
import { accountTypeLabel, formatDuration, methodLabel } from './loginEventFormat';

const T0 = '2026-09-17T10:00:00Z';
const after = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

describe('formatDuration', () => {
  it.each([
    [0, '< 1 min'],
    [0.5, '< 1 min'],
    [1, '1 min'],
    [12, '12 min'],
    [60, '1 h'],
    [192, '3 h 12 min'],
    [1440, '1 d'],
    [2 * 1440 + 4 * 60, '2 d 4 h'],
    [2 * 1440 + 4 * 60 + 59, '2 d 4 h'],
  ])('%s min → %s', (minutes, expected) => {
    expect(formatDuration(T0, after(minutes))).toBe(expected);
  });

  it('never goes negative when the end precedes the start', () => {
    expect(formatDuration(after(5), T0)).toBe('< 1 min');
  });
});

describe('methodLabel', () => {
  it.each([
    ['password', 'Password'],
    ['otp', 'Email link'],
    ['magiclink', 'Email link'],
    ['recovery', 'Email link'],
    ['email/signup', 'Email link'],
    ['invite', 'Email link'],
    ['oauth', 'OAuth'],
    ['totp', 'totp'],
    [null, '—'],
  ])('%s → %s', (method, expected) => {
    expect(methodLabel(method)).toBe(expected);
  });
});

describe('accountTypeLabel', () => {
  it.each([
    ['platform_admin', 'Platform admin'],
    ['company_owner', 'Company owner'],
    ['company_staff', 'Company staff'],
    ['trekker', 'Trekker'],
    ['something_else', 'something_else'],
    [null, '—'],
  ])('%s → %s', (type, expected) => {
    expect(accountTypeLabel(type)).toBe(expected);
  });
});
