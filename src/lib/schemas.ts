import { z } from 'zod'

// Shared input validation. This module is framework-agnostic (only depends on
// zod) so the same schemas can be reused client-side in forms and server-side
// once Route Handlers / Server Actions land. Keep it free of React, Next, or
// Supabase imports.

const emailField = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .pipe(z.email('Please enter a valid email'))

// New passwords (sign-up + reset): minimum 8 characters. The HIBP breach check
// in src/lib/auth.ts is the separate strength gate.
const newPassword = z.string().min(8, 'Password must be at least 8 characters')

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required'),
    email: emailField,
    password: newPassword,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required'),
})

export const forgotPasswordSchema = z.object({
  email: emailField,
})

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

const optionalText = (max: number) =>
  z.string().trim().max(max, `Must be ${max} characters or fewer`)

// Normalised profile shape — both edit screens map their local field names onto
// these keys before parsing (e.g. `name`/`full_name` → `fullName`).
export const profileUpdateSchema = z.object({
  fullName: optionalText(100),
  email: z.union([z.literal(''), z.email('Please enter a valid email')]),
  bio: optionalText(500),
  experienceLevel: z.string(),
  emergencyContactName: optionalText(100),
  emergencyContactRelationship: optionalText(60),
  emergencyContactPhone: z
    .string()
    .trim()
    .max(20, 'Phone must be 20 characters or fewer')
    .regex(/^[\d\s+()-]*$/, 'Enter a valid phone number'),
})

export const messageSchema = z
  .string()
  .trim()
  .min(1, 'Message cannot be empty')
  .max(2000, 'Message is too long (2000 characters max)')

// Maps a ZodError to { field: firstMessage }, keyed by the issue's path. Matches
// the `{ [field]: string }` error state the forms already use.
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!(key in out)) out[key] = issue.message
  }
  return out
}
