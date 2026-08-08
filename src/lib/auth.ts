import { createClient } from '@/utils/supabase/client'
import { createClient as createSupabaseClient, AuthError, User, Session } from '@supabase/supabase-js'

export interface SignUpData {
  email: string
  password: string
  fullName: string
  accountType?: 'trekker' | 'company'
}

export interface SignInData {
  email: string
  password: string
}

export interface SignInAsData extends SignInData {
  accountType: 'trekker' | 'company'
}

export interface SignInAsResponse extends AuthResponse {
  // Credentials were valid, but the account isn't the kind that was asked for.
  mismatch: boolean
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
export async function signUp({ email, password, fullName, accountType }: SignUpData): Promise<AuthResponse> {
  const supabase = createClient()
  try {
    if (await isPasswordPwned(password)) {
      return { user: null, session: null, error: pwnedPasswordError() }
    }

    // account_type is read once by handle_new_user() to stamp profiles.account_type,
    // then pinned by trg_protect_profile_account_type. Client-supplied is fine in
    // this direction — signing up as a company is self-service, the company itself
    // still needs platform-admin approval, and anything but the literal 'company'
    // falls back to the unrestricted 'trekker'.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          account_type: accountType === 'company' ? 'company' : 'trekker',
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

// Sign in existing user, on the side of the platform they asked for.
//
// Credentials are checked against a throwaway client that persists nothing, so
// an account of the wrong kind is turned away without a browser session ever
// being written — there is no sign-out round trip left to fail, and a flaky
// network can't strand someone signed in as a kind the UI just rejected. Only a
// match is committed to the real cookie-backed client via setSession().
export async function signInAs({ email, password, accountType }: SignInAsData): Promise<SignInAsResponse> {
  const probe = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        // Distinct from the real client's key, or supabase-js warns about two
        // GoTrue instances sharing one storage slot.
        storageKey: 'sb-trekker-login-probe',
      },
    }
  )

  try {
    const { data, error } = await probe.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      return { user: null, session: null, error, mismatch: false }
    }

    // The company side asks the raw column, because only a company account has
    // anything at /dashboard. The trekker side asks is_trekker(), the same
    // predicate the RLS gates use, so platform admins keep both doors open.
    let allowed: boolean
    if (accountType === 'company') {
      const { data: profile, error: profileError } = await probe
        .from('profiles')
        .select('account_type')
        .eq('id', data.user.id)
        .maybeSingle()
      if (profileError) console.error('Error checking account type:', profileError)
      allowed = profile?.account_type === 'company'
    } else {
      const { data: trekker, error: trekkerError } = await probe.rpc('is_trekker')
      if (trekkerError) console.error('Error checking account type:', trekkerError)
      allowed = trekker === true
    }

    if (!allowed) {
      // Nothing was persisted locally; this just revokes the refresh token the
      // password check minted, so it can't be replayed.
      await probe.auth.signOut({ scope: 'local' })
      return { user: null, session: null, error: null, mismatch: true }
    }

    const supabase = createClient()
    const { data: committed, error: commitError } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
    if (commitError) {
      return { user: null, session: null, error: commitError, mismatch: false }
    }

    return { user: committed.user, session: committed.session, error: null, mismatch: false }
  } catch (error) {
    return { user: null, session: null, error: error as AuthError, mismatch: false }
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
