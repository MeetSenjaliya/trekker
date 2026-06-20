import { describe, it, expect } from 'vitest'
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  profileUpdateSchema,
  messageSchema,
  fieldErrors,
} from '@/lib/schemas'

describe('signUpSchema', () => {
  const valid = {
    fullName: 'Asha Patel',
    email: 'asha@example.com',
    password: 'supersecret',
    confirmPassword: 'supersecret',
  }

  it('accepts a valid signup', () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects passwords shorter than 8 characters', () => {
    const r = signUpSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(fieldErrors(r.error).password).toMatch(/at least 8/)
    }
  })

  it('rejects mismatched passwords on the confirmPassword field', () => {
    const r = signUpSchema.safeParse({ ...valid, confirmPassword: 'different1' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(fieldErrors(r.error).confirmPassword).toMatch(/do not match/)
    }
  })

  it('rejects an invalid email', () => {
    const r = signUpSchema.safeParse({ ...valid, email: 'not-an-email' })
    expect(r.success).toBe(false)
  })

  it('rejects a blank full name', () => {
    const r = signUpSchema.safeParse({ ...valid, fullName: '   ' })
    expect(r.success).toBe(false)
  })
})

describe('signInSchema', () => {
  it('accepts any non-empty password', () => {
    expect(
      signInSchema.safeParse({ email: 'a@b.com', password: 'x' }).success
    ).toBe(true)
  })

  it('requires a password', () => {
    expect(
      signInSchema.safeParse({ email: 'a@b.com', password: '' }).success
    ).toBe(false)
  })
})

describe('forgotPasswordSchema', () => {
  it('trims and validates the email', () => {
    const r = forgotPasswordSchema.safeParse({ email: '  user@example.com ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBe('user@example.com')
  })
})

describe('resetPasswordSchema', () => {
  it('enforces the 8-char minimum and matching confirmation', () => {
    expect(
      resetPasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'longenough' }).success
    ).toBe(true)
    expect(
      resetPasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'mismatch12' }).success
    ).toBe(false)
  })
})

describe('profileUpdateSchema', () => {
  const valid = {
    fullName: 'Asha',
    email: '',
    bio: 'I hike.',
    experienceLevel: 'beginner',
    emergencyContactName: 'Ravi',
    emergencyContactRelationship: 'brother',
    emergencyContactPhone: '+91 98765 43210',
  }

  it('allows an empty email', () => {
    expect(profileUpdateSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a phone with invalid characters', () => {
    const r = profileUpdateSchema.safeParse({ ...valid, emergencyContactPhone: 'call me' })
    expect(r.success).toBe(false)
    if (!r.success) expect(fieldErrors(r.error).emergencyContactPhone).toMatch(/valid phone/)
  })

  it('rejects a bio over 500 characters', () => {
    const r = profileUpdateSchema.safeParse({ ...valid, bio: 'a'.repeat(501) })
    expect(r.success).toBe(false)
  })
})

describe('messageSchema', () => {
  it('rejects empty / whitespace messages', () => {
    expect(messageSchema.safeParse('   ').success).toBe(false)
  })

  it('caps messages at 2000 characters', () => {
    expect(messageSchema.safeParse('a'.repeat(2000)).success).toBe(true)
    expect(messageSchema.safeParse('a'.repeat(2001)).success).toBe(false)
  })
})

describe('fieldErrors', () => {
  it('keeps the first message per field and keys nested paths by dot path', () => {
    const r = signUpSchema.safeParse({
      fullName: '',
      email: 'bad',
      password: 'x',
      confirmPassword: 'y',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      const errors = fieldErrors(r.error)
      expect(errors.fullName).toBeDefined()
      expect(errors.email).toBeDefined()
      expect(errors.password).toBeDefined()
    }
  })
})
