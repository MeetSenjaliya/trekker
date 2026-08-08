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

// Company operators have no /profile/edit (that lives under the trekker route
// group), so /dashboard/account edits just the one field that means anything for
// them. Same 100-char cap as profileUpdateSchema.fullName, but required — a
// blank name would leave the team roster showing nothing.
export const accountNameSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required').max(100, 'Must be 100 characters or fewer'),
})

export const messageSchema = z
  .string()
  .trim()
  .min(1, 'Message cannot be empty')
  .max(2000, 'Message is too long (2000 characters max)')

// Company application (multi-tenant Phase B). Slug rule and 60-char cap match
// the CHECK constraints on public.companies / the apply_for_company() RPC, so
// anything that passes here won't bounce off the database.
export const companyApplicationSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(100, 'Must be 100 characters or fewer'),
  slug: z
    .string()
    .trim()
    .min(1, 'URL slug is required')
    .max(60, 'Must be 60 characters or fewer')
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only (e.g. himalayan-trails)'),
  description: optionalText(1000),
  contactEmail: z.union([z.literal(''), z.email('Please enter a valid email')]),
  contactPhone: z
    .string()
    .trim()
    .max(20, 'Phone must be 20 characters or fewer')
    .regex(/^[\d\s+()-]*$/, 'Enter a valid phone number'),
  website: z.union([z.literal(''), z.url('Please enter a valid URL (include https://)')]),
})

// Company profile edit (dashboard settings). Same fields as the application
// minus the slug, which is immutable after creation (v1).
export const companyProfileSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(100, 'Must be 100 characters or fewer'),
  description: optionalText(1000),
  contactEmail: z.union([z.literal(''), z.email('Please enter a valid email')]),
  contactPhone: z
    .string()
    .trim()
    .max(20, 'Phone must be 20 characters or fewer')
    .regex(/^[\d\s+()-]*$/, 'Enter a valid phone number'),
  website: z.union([z.literal(''), z.url('Please enter a valid URL (include https://)')]),
})

// '' -> null, otherwise a non-negative number. Trek form numeric fields arrive
// as strings from the inputs; the DB columns are nullable numeric.
const optionalNumber = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0), `${label} must be a non-negative number`)
    .transform((v) => (v === '' ? null : Number(v)))

const optionalInt = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 0), `${label} must be a whole number`)
    .transform((v) => (v === '' ? null : Number(v)))

export const difficultyValues = ['Easy', 'Moderate', 'Hard', 'Expert'] as const

// Trek create/edit (dashboard). Shared by /dashboard/treks/new and .../[id]/edit.
// gearChecklist is a newline-separated textarea in the UI, stored as text[].
export const trekFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(150, 'Must be 150 characters or fewer'),
  description: optionalText(2000),
  location: optionalText(200),
  difficulty: z.enum(difficultyValues, { message: 'Select a difficulty' }),
  distanceKm: optionalNumber('Distance'),
  durationHours: optionalNumber('Duration'),
  meetingPoint: optionalText(300),
  meetingPoint2: optionalText(300),
  estimatedCost: optionalNumber('Cost'),
  maxParticipants: optionalInt('Max participants'),
  gearChecklist: z
    .string()
    .max(2000, 'Must be 2000 characters or fewer')
    .transform((s) => s.split('\n').map((line) => line.trim()).filter(Boolean)),
})

// The user's local calendar date as YYYY-MM-DD. toISOString() would give the
// UTC date, which is still "yesterday" for timezones behind UTC late in the
// day — rejecting a departure for the user's actual today.
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// One year from today, as YYYY-MM-DD. Mirrors the join_trek_and_chat guard
// (batch_date > current_date + interval '1 year' is rejected), so departures
// that could never be booked can't be listed in the first place.
const localMaxBatchDate = () => {
  const d = new Date()
  return `${d.getFullYear() + 1}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Trek batch (dated departure) create.
export const batchSchema = z.object({
  batchDate: z
    .string()
    .min(1, 'Date is required')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date')
    .refine((v) => v >= localToday(), 'Date must be today or later')
    .refine((v) => v <= localMaxBatchDate(), 'Date must be within one year'),
  maxParticipants: optionalInt('Capacity'),
})

// Invite a teammate by the email on their Trekker account.
export const inviteMemberSchema = z.object({
  email: emailField,
})

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
