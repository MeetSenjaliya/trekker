import { createClient } from '@/utils/supabase/client'
import { AuthError, User, Session } from '@supabase/supabase-js'

export interface SignUpData {
  email: string
  password: string
  fullName: string
}

export interface SignInData {
  email: string
  password: string
}

export interface AuthResponse {
  user: User | null
  session: Session | null
  error: AuthError | null
}

// Free-plan replacement for Supabase's "leaked password protection" (Pro-only).
// Uses HaveIBeenPwned's Pwned Passwords range API with k-anonymity: only the
// first 5 chars of the SHA-1 hash leave the browser, never the password.
// https://haveibeenpwned.com/API/v3#PwnedPasswords
export async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const buffer = await crypto.subtle.digest(
      'SHA-1',
      new TextEncoder().encode(password)
    )
    const hash = Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`)
    if (!res.ok) return false
    const body = await res.text()

    return body
      .split('\n')
      .some((line) => line.split(':')[0]?.trim() === suffix)
  } catch {
    // Fail open: a HIBP outage must not block legitimate sign-ups.
    return false
  }
}

const PWNED_PASSWORD_MESSAGE =
  'This password has appeared in a known data breach. Please choose a different one.'

function pwnedPasswordError(): AuthError {
  return new AuthError(PWNED_PASSWORD_MESSAGE, 422, 'weak_password')
}

// Sign up new user
export async function signUp({ email, password, fullName }: SignUpData): Promise<AuthResponse> {
  const supabase = createClient()
  try {
    if (await isPasswordPwned(password)) {
      return { user: null, session: null, error: pwnedPasswordError() }
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    })

    if (error) {
      return { user: null, session: null, error }
    }

    // The profiles row is created server-side by the handle_new_user()
    // trigger on auth.users (see supabase/security-fixes.sql, NEW-2).
    // Doing it from the browser fails under RLS when email confirmation
    // is enabled (no session -> anon insert is rejected), so it must not
    // be done here.

    return { user: data.user, session: data.session, error: null }
  } catch (error) {
    return { user: null, session: null, error: error as AuthError }
  }
}

// Sign in existing user
export async function signIn({ email, password }: SignInData): Promise<AuthResponse> {
  const supabase = createClient()
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    return { user: data.user, session: data.session, error }
  } catch (error) {
    return { user: null, session: null, error: error as AuthError }
  }
}

// Sign out user
export async function signOut(): Promise<{ error: AuthError | null }> {
  const supabase = createClient()
  try {
    const { error } = await supabase.auth.signOut()
    return { error }
  } catch (error) {
    return { error: error as AuthError }
  }
}

// Reset password
export async function resetPassword(email: string): Promise<{ error: AuthError | null }> {
  const supabase = createClient()
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    return { error }
  } catch (error) {
    return { error: error as AuthError }
  }
}

// Update the current user's password (used by the reset-password page once a
// recovery session has been established via verifyOtp).
export async function updatePassword(password: string): Promise<{ error: AuthError | null }> {
  const supabase = createClient()
  try {
    if (await isPasswordPwned(password)) {
      return { error: pwnedPasswordError() }
    }

    const { error } = await supabase.auth.updateUser({ password })
    return { error }
  } catch (error) {
    return { error: error as AuthError }
  }
}

// Get current user and session
export async function getCurrentUser(): Promise<{ user: User | null; session: Session | null }> {
  const supabase = createClient()
  try {
    // getUser() is safer as it validates the token with the server
    const { data: { user } } = await supabase.auth.getUser()
    const { data: { session } } = await supabase.auth.getSession()

    return { user, session }
  } catch (error) {
    console.error('Error getting current user:', error)
    return { user: null, session: null }
  }
}

// Listen to auth state changes
export function onAuthStateChange(callback: (user: User | null, session: Session | null) => void) {
  const supabase = createClient()
  return supabase.auth.onAuthStateChange((event, session) => {
    // Forward the session to the callback as requested
    callback(session?.user ?? null, session)
  })
}
