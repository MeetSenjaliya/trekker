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

// Sign up new user
export async function signUp({ email, password, fullName }: SignUpData): Promise<AuthResponse> {
  const supabase = createClient()
  try {
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

    // If signup successful, create user profile
    if (data.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([
          {
            id: data.user.id,            // Must match auth.users.id
            full_name: fullName,         // Provided by form
            bio: null,                   // Optional field
            experience_level: null,      // Optional field
            emergency_contact: null,     // Optional field
            avatar_url: null,           // Optional field
            // created_at will auto-fill if your table has `default now()`
          },
        ]);

      if (profileError) {
        console.error('Error creating profile:', profileError);
        // Profile creation failed, but auth was successful
      }
    }

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
